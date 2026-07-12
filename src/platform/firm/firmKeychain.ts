/**
 * firmKeychain — secret storage for the firm tier, in the OS keychain.
 *
 * The firm tier holds three kinds of secret that MUST live in the OS keychain,
 * never `localStorage` (this is the explicit fix the backend README + the old
 * `useLicense` TODO call out):
 *
 *   - the access + refresh tokens   -> service `com.lantern.user.<user_id>`
 *   - the signed Ed25519 seat token -> service `com.lantern.user.<user_id>`
 *   - the per-matter AES content key -> a service derived from the local Matter identifier
 *
 * On the desktop (Tauri) these go to the real OS keychain via the existing
 * `keychain_*` commands (macOS Keychain / Windows Credential Manager / Linux
 * Secret Service). The Rust side already accepts an optional `service`
 * namespace, so no Rust change is needed.
 *
 * In the BROWSER / dev / test environment there is no OS keychain. We fall back
 * to an obfuscated `localStorage` shelf (the same posture the existing
 * `KeychainService` dev backend uses) and the UI labels firm sign-in as
 * desktop-grade only in the app. The fallback keeps the modules runnable and
 * unit-testable; it is NEVER the storage on a real install.
 */

import { keychainCompareAndDelete, keychainCompareAndSet, keychainGet, keychainSet, keychainDelete } from '@/platform/utils/tauri-commands';
import { isTauri } from '@tauri-apps/api/core';
import { kcUserService, kcMatterService, KC_FALLBACK_PREFIX, KC_FIRM_NS } from '@/config/identity';
import { OPAQUE_BLOB_ID_PATTERN, OPAQUE_PROVISIONING_NONCE_PATTERN } from './opaqueBlobId';
import { parseMatterHandle, parseStreamHandle, type MatterHandle, type StreamHandle } from './contract';

/** Service namespace for a user's auth + seat tokens. */
export function userService(userId: string): string {
  return kcUserService(userId);
}

/** Service namespace for a matter's content key. */
export function matterService(matterId: string): string {
  return kcMatterService(matterId);
}

// Keys within the user service.
export const KC_ACCESS_TOKEN = 'access_token';
export const KC_REFRESH_TOKEN = 'refresh_token';
export const KC_SEAT_TOKEN = 'seat_token';
// Key within a matter service (the raw AES key, base64).
export const KC_MATTER_KEY = 'content_key';
const KC_PROMOTION_PENDING = 'promotion_pending';
const KC_DOCUMENT_STREAM_PIN_PREFIX = 'document_stream_pin:';
type CompareAndSetResult = { swapped: boolean; current: string | null };

function fallbackAvailable(): boolean {
  return typeof localStorage !== 'undefined';
}

function fallbackKey(service: string, key: string): string {
  return `${KC_FALLBACK_PREFIX}${service}::${key}`;
}

/** UTF-8-safe base64 encode (dev fallback only; not a security boundary). */
function utf8ToB64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

/** UTF-8-safe base64 decode (dev fallback only). */
function b64ToUtf8(b64: string): string {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

async function setSecret(service: string, key: string, value: string): Promise<void> {
  if (isTauri()) {
    await keychainSet(key, value, service);
    return;
  }
  if (fallbackAvailable()) {
    // Base64 obfuscation only — matches the existing dev KeychainService; not
    // a security boundary. Real installs use the OS keychain above.
    localStorage.setItem(fallbackKey(service, key), utf8ToB64(value));
    return;
  }
  throw new Error('No secret storage available (not Tauri, no localStorage).');
}

async function getSecret(service: string, key: string): Promise<string | null> {
  if (isTauri()) {
    try {
      return await keychainGet(key, service);
    } catch {
      // keychain_get throws a structured NotFound; treat any miss as null.
      return null;
    }
  }
  if (fallbackAvailable()) {
    const raw = localStorage.getItem(fallbackKey(service, key));
    if (raw == null) return null;
    try {
      return b64ToUtf8(raw);
    } catch {
      return null;
    }
  }
  return null;
}

async function deleteSecret(service: string, key: string): Promise<void> {
  if (isTauri()) {
    await keychainDelete(key, service);
    return;
  }
  if (fallbackAvailable()) {
    localStorage.removeItem(fallbackKey(service, key));
  }
}

/** Atomically write a device-local value only when it still equals `expected`. */
async function compareAndSetSecret(
  service: string,
  key: string,
  expected: string | null,
  next: string,
): Promise<{ swapped: boolean; current: string | null }> {
  if (isTauri()) return keychainCompareAndSet(key, expected, next, service);
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
  const run = async (): Promise<CompareAndSetResult> => {
    const current = await getSecret(service, key);
    if (current !== expected) return { swapped: false, current };
    await setSecret(service, key, next);
    return { swapped: true, current };
  };
  // TypeScript's DOM declaration loses the callback result as `Promise<any>`.
  // The Locks API resolves with exactly the typed value returned by `run`.
  if (locks) return locks.request(`lantern-firm-keychain:${service}:${key}`, { mode: 'exclusive' }, run) as Promise<CompareAndSetResult>;
  // Test-only/non-browser fallback. Production desktop uses the native lock.
  return run();
}

/**
 * Device-local trust-on-first-use pins for document stream routing.
 *
 * These pins deliberately live outside Yjs and the relay. A shared CRDT entry
 * is useful for collaboration, but never sufficient evidence for a destructive
 * stream release.
 */
function documentStreamPinService(matterHandle: MatterHandle): string {
  return `${KC_FIRM_NS}.firm-document-stream-pins.${parseMatterHandle(matterHandle)}`;
}

function documentStreamPinKey(localDocumentId: string): string {
  if (localDocumentId.length === 0) throw new Error('Cannot pin an empty local document ID.');
  return `${KC_DOCUMENT_STREAM_PIN_PREFIX}${utf8ToB64(localDocumentId).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')}`;
}

/** Return this device's pinned opaque stream handle, if any. */
export async function getPinnedDocumentStream(
  matterHandle: MatterHandle,
  localDocumentId: string,
): Promise<StreamHandle | null> {
  const raw = await getSecret(documentStreamPinService(matterHandle), documentStreamPinKey(localDocumentId));
  if (raw === null) return null;
  try {
    return parseStreamHandle(raw);
  } catch {
    throw new Error('The saved document stream pin is invalid. Refusing destructive release.');
  }
}

/** Remove this device's document-stream pin. Missing pins are harmless. */
export async function deletePinnedDocumentStream(
  matterHandle: MatterHandle,
  localDocumentId: string,
): Promise<void> {
  await deleteSecret(documentStreamPinService(matterHandle), documentStreamPinKey(localDocumentId));
}

/**
 * Atomically establish a pin on first observation. Later observations receive
 * the original value and must compare it before doing anything destructive.
 */
export async function pinDocumentStreamOnFirstObservation(
  matterHandle: MatterHandle,
  localDocumentId: string,
  observedStreamHandle: StreamHandle,
): Promise<StreamHandle> {
  const service = documentStreamPinService(matterHandle);
  const key = documentStreamPinKey(localDocumentId);
  const wanted = parseStreamHandle(observedStreamHandle);
  for (;;) {
    const current = await getSecret(service, key);
    if (current !== null) {
      try {
        return parseStreamHandle(current);
      } catch {
        throw new Error('The saved document stream pin is invalid. Refusing destructive release.');
      }
    }
    const result = await compareAndSetSecret(service, key, null, wanted);
    if (result.swapped) return wanted;
  }
}

/**
 * A local crash/retry ledger for sharing a client. It is secret storage because
 * it contains the content key and encrypted first write; the relay sees only
 * its opaque handles and ciphertext. Keeping it until a success or confirmed
 * archive prevents a timeout from creating an unreachable second shell.
 */
export interface PromotionPendingRecord {
  /** The receipt is only valid for this exact local client and firm identity. */
  localMatterId: string;
  userId: string;
  orgId: string;
  /** Written before the first request. This survives a lost provision reply. */
  provisioningNonce: string;
  matterHandle?: string;
  rootStreamHandle?: string;
  keyEpoch?: number;
  keyB64?: string;
  rootBlobId?: string;
  rootCiphertextB64?: string;
  /**
   * Set immediately after the relay accepts the first encrypted root write.
   * Before this point a definite rejection can safely discard the shell; after
   * it, the pending receipt and local key are recovery material and must stay.
   * Older receipts without this field are pre-root-write receipts.
   */
  rootWriteAccepted?: boolean;
  /** A finished receipt lets another window adopt the same local linkage. */
  completed?: boolean;
  /** Short durable ownership lease. It is never a substitute for the receipt. */
  leaseOwnerId?: string;
  leaseExpiresAt?: number;
  /** A fenced, recoverable pre-root-write cleanup is in progress. */
  cleanupPending?: boolean;
}

export interface PromotionReceiptContext {
  localMatterId: string;
  userId: string;
  orgId: string;
}

function promotionService(localMatterId: string): string {
  return `com.lantern.matter-promotion.${localMatterId}`;
}

const PROMOTION_LEASE_MS = 30_000;
/** Do not mistake a years-long hostile expiry for a live window. */
const MAX_PROMOTION_LEASE_MS = 60_000;
const LEASE_OWNER_PATTERN = /^[a-f0-9]{32}$/;
const MATTER_HANDLE_PATTERN = /^mh2_[A-Za-z0-9_-]{43}$/;
const STREAM_HANDLE_PATTERN = /^sh2_[A-Za-z0-9_-]{43}$/;

function newLeaseOwnerId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export class PromotionReceiptError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PromotionReceiptError';
  }
}

function hasNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/** Validate every receipt field other than the identity fields added after v1. */
function validPromotionRecordContents(value: unknown, now = Date.now()): value is Omit<PromotionPendingRecord, keyof PromotionReceiptContext> {
  if (!value || typeof value !== 'object') return false;
  const record = value as PromotionPendingRecord;
  if (!OPAQUE_PROVISIONING_NONCE_PATTERN.test(record.provisioningNonce)) return false;

  const hasProvision = MATTER_HANDLE_PATTERN.test(record.matterHandle ?? '')
    && STREAM_HANDLE_PATTERN.test(record.rootStreamHandle ?? '')
    && Number.isSafeInteger(record.keyEpoch) && (record.keyEpoch ?? 0) > 0;
  const hasAnyProvision = record.matterHandle !== undefined || record.rootStreamHandle !== undefined || record.keyEpoch !== undefined;
  const hasCrypto = hasNonEmptyString(record.keyB64)
    && OPAQUE_BLOB_ID_PATTERN.test(record.rootBlobId ?? '')
    && hasNonEmptyString(record.rootCiphertextB64);
  const hasAnyCrypto = record.keyB64 !== undefined || record.rootBlobId !== undefined || record.rootCiphertextB64 !== undefined;
  if ((hasAnyProvision && !hasProvision) || (hasAnyCrypto && (!hasCrypto || !hasProvision))) return false;
  if (record.rootWriteAccepted !== undefined && typeof record.rootWriteAccepted !== 'boolean') return false;
  if (record.completed !== undefined && typeof record.completed !== 'boolean') return false;
  if (record.cleanupPending !== undefined && typeof record.cleanupPending !== 'boolean') return false;
  if (record.rootWriteAccepted && (!hasProvision || (!hasCrypto && !record.completed))) return false;
  if (record.completed && (!record.rootWriteAccepted || !hasProvision || record.cleanupPending)) return false;
  if (record.cleanupPending && (record.rootWriteAccepted || record.completed)) return false;

  const hasLeaseOwner = record.leaseOwnerId !== undefined;
  const hasLeaseExpiry = record.leaseExpiresAt !== undefined;
  if (hasLeaseOwner !== hasLeaseExpiry) return false;
  if (hasLeaseOwner && (
    !LEASE_OWNER_PATTERN.test(record.leaseOwnerId ?? '')
    || !Number.isSafeInteger(record.leaseExpiresAt)
    || (record.leaseExpiresAt ?? 0) > now + MAX_PROMOTION_LEASE_MS
  )) return false;
  return true;
}

/** Strictly check every durable shape before it can be adopted or mutated. */
function validPromotionRecord(value: unknown, context: PromotionReceiptContext, now = Date.now()): value is PromotionPendingRecord {
  if (!validPromotionRecordContents(value, now)) return false;
  const record = value as PromotionPendingRecord;
  return record.localMatterId === context.localMatterId
    && record.userId === context.userId
    && record.orgId === context.orgId;
}

/**
 * The first production receipt shape did not record its local/client identity.
 * Only an entirely identity-free, otherwise valid legacy record may be stamped
 * with the current session. Any partial or conflicting identity remains a hard
 * failure: it may be a receipt from another account or client.
 */
function isIdentityFreeLegacyPromotionRecord(value: unknown, now = Date.now()): value is Omit<PromotionPendingRecord, keyof PromotionReceiptContext> {
  if (!validPromotionRecordContents(value, now) || typeof value !== 'object') return false;
  const record = value as Partial<PromotionPendingRecord>;
  return record.localMatterId === undefined
    && record.userId === undefined
    && record.orgId === undefined;
}

function promotionCasResult(value: unknown): { swapped: boolean; current: string | null } {
  if (!value || typeof value !== 'object') throw new Error('The promotion receipt comparison returned an invalid result.');
  const result = value as { swapped?: unknown; current?: unknown };
  if (typeof result.swapped !== 'boolean' || (result.current !== null && typeof result.current !== 'string')) {
    throw new Error('The promotion receipt comparison returned an invalid result.');
  }
  return { swapped: result.swapped, current: result.current };
}

async function rawPromotionPending(localMatterId: string): Promise<string | null> {
  return getSecret(promotionService(localMatterId), KC_PROMOTION_PENDING);
}

async function compareAndSetPromotionPending(
  localMatterId: string,
  expected: string | null,
  next: PromotionPendingRecord,
): Promise<{ swapped: boolean; current: string | null }> {
  const service = promotionService(localMatterId);
  const value = JSON.stringify(next);
  if (isTauri()) return keychainCompareAndSet(KC_PROMOTION_PENDING, expected, value, service);

  // Browser/dev uses the platform's cross-tab exclusive lock around the same
  // durable localStorage compare-and-set. Production desktop uses the native
  // OS-wide lock above. Modern Chromium (including the app's WebView) has it.
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
  const run = async () => {
    const current = await rawPromotionPending(localMatterId);
    if (current !== expected) return { swapped: false, current };
    await setSecret(service, KC_PROMOTION_PENDING, value);
    return { swapped: true, current };
  };
  if (locks) return promotionCasResult(await locks.request(`lantern-promotion:${localMatterId}`, { mode: 'exclusive' }, run));
  // Test-only/non-browser fallback. Real desktop never reaches this path.
  return run();
}

/** Atomically stamp the provenance omitted by the pre-identity receipt format. */
async function migrateIdentityFreePromotionRecord(
  localMatterId: string,
  raw: string,
  value: unknown,
  context: PromotionReceiptContext,
  now: number,
): Promise<PromotionPendingRecord | 'retry' | null> {
  if (!isIdentityFreeLegacyPromotionRecord(value, now)) return null;
  const migrated: PromotionPendingRecord = { ...value, ...context };
  if (!validPromotionRecord(migrated, context, now)) return null;
  const result = await compareAndSetPromotionPending(localMatterId, raw, migrated);
  return result.swapped ? migrated : 'retry';
}

async function compareAndDeletePromotionPending(
  localMatterId: string,
  expected: string,
): Promise<{ swapped: boolean; current: string | null }> {
  const service = promotionService(localMatterId);
  if (isTauri()) return keychainCompareAndDelete(KC_PROMOTION_PENDING, expected, service);
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
  const run = async () => {
    const current = await rawPromotionPending(localMatterId);
    if (current !== expected) return { swapped: false, current };
    await deleteSecret(service, KC_PROMOTION_PENDING);
    return { swapped: true, current };
  };
  if (locks) return promotionCasResult(await locks.request(`lantern-promotion:${localMatterId}`, { mode: 'exclusive' }, run));
  return run();
}

export interface PromotionClaim {
  record: PromotionPendingRecord;
  ownerId: string;
  owned: boolean;
}

/**
 * Atomically create or take over the durable promotion receipt. A losing
 * window receives the winning receipt to adopt; it must never mint a nonce.
 */
export async function claimPromotionPending(context: PromotionReceiptContext, forceTakeover = false): Promise<PromotionClaim> {
  const { localMatterId } = context;
  const ownerId = newLeaseOwnerId();
  for (;;) {
    const raw = await rawPromotionPending(localMatterId);
    const now = Date.now();
    if (!raw) {
      const record: PromotionPendingRecord = {
        ...context,
        provisioningNonce: `pn2_${base64UrlRandom(32)}`,
        leaseOwnerId: ownerId,
        leaseExpiresAt: now + PROMOTION_LEASE_MS,
      };
      const result = await compareAndSetPromotionPending(localMatterId, null, record);
      if (result.swapped) return { record, ownerId, owned: true };
      continue;
    }
    let value: unknown;
    try { value = JSON.parse(raw) as unknown; } catch { throw new PromotionReceiptError('The saved sharing receipt is corrupted. Reset it before sharing this client again.'); }
    let record: PromotionPendingRecord;
    if (validPromotionRecord(value, context, now)) {
      record = value;
    } else {
      const migrated = await migrateIdentityFreePromotionRecord(localMatterId, raw, value, context, now);
      if (migrated === 'retry') continue;
      if (!migrated) throw new PromotionReceiptError('The saved sharing receipt is invalid for this client or firm account. Reset it before sharing this client again.');
      record = migrated;
    }
    if (record.completed) return { record, ownerId, owned: false };
    if (!forceTakeover && typeof record.leaseExpiresAt === 'number' && record.leaseExpiresAt > now && record.leaseOwnerId) {
      return { record, ownerId, owned: false };
    }
    // A crashed owner may be replaced only by preserving every checkpoint,
    // especially the provisioning nonce/opaque handle/key recovery material.
    const adopted = { ...record, leaseOwnerId: ownerId, leaseExpiresAt: now + PROMOTION_LEASE_MS };
    const result = await compareAndSetPromotionPending(localMatterId, raw, adopted);
    if (result.swapped) return { record: adopted, ownerId, owned: true };
  }
}

function lostLease(): Error {
  return new Error('This sharing window lost its lease to another window. Please try again.');
}

async function mutateOwnedPromotionPending(
  context: PromotionReceiptContext,
  ownerId: string,
  mutate: (record: PromotionPendingRecord) => PromotionPendingRecord,
): Promise<PromotionPendingRecord> {
  const raw = await rawPromotionPending(context.localMatterId);
  if (!raw) throw lostLease();
  let current: PromotionPendingRecord;
  try { current = JSON.parse(raw) as PromotionPendingRecord; } catch { throw lostLease(); }
  const now = Date.now();
  if (!validPromotionRecord(current, context, now) || current.completed || current.leaseOwnerId !== ownerId || (current.leaseExpiresAt ?? 0) <= now) {
    throw lostLease();
  }
  const next = { ...mutate(current), ...context, leaseOwnerId: ownerId, leaseExpiresAt: now + PROMOTION_LEASE_MS };
  if (!validPromotionRecord(next, context, now)) throw new PromotionReceiptError('The sharing checkpoint is invalid.');
  const result = await compareAndSetPromotionPending(context.localMatterId, raw, next);
  if (!result.swapped) throw lostLease();
  return next;
}

/** Heartbeat renewal and every checkpoint both use this same fenced mutation. */
export async function renewPromotionPendingLease(context: PromotionReceiptContext, ownerId: string): Promise<PromotionPendingRecord> {
  return mutateOwnedPromotionPending(context, ownerId, (record) => record);
}

/** Save a checkpoint only when this exact window still holds the lease. */
export async function storePromotionPending(
  context: PromotionReceiptContext,
  ownerId: string,
  record: PromotionPendingRecord,
): Promise<PromotionPendingRecord> {
  return mutateOwnedPromotionPending(context, ownerId, () => record);
}

/** Give up the short execution lease without deleting recovery material. */
export async function releasePromotionPendingLease(
  context: PromotionReceiptContext,
  ownerId: string,
): Promise<void> {
  const { localMatterId } = context;
  const raw = await rawPromotionPending(localMatterId);
  if (!raw) return;
  try {
    const record = JSON.parse(raw) as PromotionPendingRecord;
    if (!validPromotionRecord(record, context) || record.leaseOwnerId !== ownerId || record.completed) return;
    const { leaseOwnerId: _leaseOwnerId, leaseExpiresAt: _leaseExpiresAt, ...unleased } = record;
    await compareAndSetPromotionPending(localMatterId, raw, unleased);
  // eslint-disable-next-line lantern-async/no-silent-failure -- a corrupt receipt must never be altered by a releasing window.
  } catch {
    // A corrupt receipt is handled by the explicit load/claim error path.
  }
}

/** Keep a compact terminal receipt so another window can adopt its linkage. */
export async function completePromotionPending(
  context: PromotionReceiptContext,
  ownerId: string,
  record: PromotionPendingRecord,
): Promise<void> {
  const { localMatterId } = context;
  const raw = await rawPromotionPending(localMatterId);
  if (!raw) throw new Error('The saved sharing retry record disappeared.');
  const current = JSON.parse(raw) as PromotionPendingRecord;
  const now = Date.now();
  if (!validPromotionRecord(current, context, now) || current.leaseOwnerId !== ownerId || (current.leaseExpiresAt ?? 0) <= now) throw lostLease();
  if (!record.matterHandle || !record.rootStreamHandle || !record.keyEpoch) throw new PromotionReceiptError('The sharing completion receipt is incomplete.');
  const terminal: PromotionPendingRecord = {
    ...context,
    provisioningNonce: record.provisioningNonce,
    matterHandle: record.matterHandle,
    rootStreamHandle: record.rootStreamHandle,
    keyEpoch: record.keyEpoch,
    rootWriteAccepted: true,
    completed: true,
  };
  const result = await compareAndSetPromotionPending(localMatterId, raw, terminal);
  if (!result.swapped) throw new Error('Another window is finishing this shared client.');
}

/** Fence cleanup before the first destructive relay call. The cleanup marker
 * prevents any future owner from resuming this pre-root-write shell as a share. */
export async function beginPromotionPendingCleanup(
  context: PromotionReceiptContext,
  ownerId: string,
): Promise<PromotionPendingRecord> {
  return mutateOwnedPromotionPending(context, ownerId, (record) => {
    if (record.rootWriteAccepted || record.completed || record.cleanupPending) throw lostLease();
    return { ...record, cleanupPending: true };
  });
}

/** Clear only the exact cleanup receipt this window fenced and completed. */
export async function clearPromotionPendingAfterCleanup(
  context: PromotionReceiptContext,
  ownerId: string,
): Promise<void> {
  const raw = await rawPromotionPending(context.localMatterId);
  if (!raw) throw lostLease();
  let record: PromotionPendingRecord;
  try { record = JSON.parse(raw) as PromotionPendingRecord; } catch { throw lostLease(); }
  const now = Date.now();
  if (!validPromotionRecord(record, context, now) || !record.cleanupPending || record.leaseOwnerId !== ownerId || (record.leaseExpiresAt ?? 0) <= now) throw lostLease();
  const result = await compareAndDeletePromotionPending(context.localMatterId, raw);
  if (!result.swapped) throw lostLease();
}

function base64UrlRandom(byteCount: number): string {
  const bytes = new Uint8Array(byteCount);
  crypto.getRandomValues(bytes);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/u, '');
}

export async function loadPromotionPending(context: PromotionReceiptContext): Promise<PromotionPendingRecord | null> {
  const { localMatterId } = context;
  for (;;) {
    const raw = await rawPromotionPending(localMatterId);
    if (!raw) return null;
    const now = Date.now();
    try {
      const value = JSON.parse(raw) as unknown;
      if (validPromotionRecord(value, context, now)) return value;
      const migrated = await migrateIdentityFreePromotionRecord(localMatterId, raw, value, context, now);
      if (migrated === 'retry') continue;
      return migrated;
    } catch {
      return null;
    }
  }
}

/** Deliberate recovery action for a receipt rejected by strict validation. */
export async function resetPromotionPending(context: PromotionReceiptContext): Promise<void> {
  const raw = await rawPromotionPending(context.localMatterId);
  if (!raw) return;
  try {
    const record = JSON.parse(raw) as Record<string, unknown>;
    const belongsToAnotherContext = typeof record['localMatterId'] === 'string' && (
      record['localMatterId'] !== context.localMatterId || record['userId'] !== context.userId || record['orgId'] !== context.orgId
    );
    if (belongsToAnotherContext) throw new PromotionReceiptError('This saved sharing receipt belongs to another client or firm account.');
    if (validPromotionRecord(record, context) && (record.completed || (record.leaseExpiresAt ?? 0) > Date.now())) {
      throw new PromotionReceiptError('A valid sharing receipt is still active and cannot be reset.');
    }
  } catch (error) {
    if (error instanceof PromotionReceiptError) throw error;
    // A non-JSON or malformed record is precisely what this deliberate reset
    // repairs. Its exact raw value remains the CAS expectation below.
  }
  const result = await compareAndDeletePromotionPending(context.localMatterId, raw);
  if (!result.swapped) throw new Error('The sharing receipt changed. Please try again.');
}

// --- Auth + seat tokens (per user) -----------------------------------------

export interface StoredFirmTokens {
  accessToken: string;
  refreshToken: string;
  seatToken?: string | null;
}

export async function storeAuthTokens(
  userId: string,
  accessToken: string,
  refreshToken: string,
): Promise<void> {
  const svc = userService(userId);
  await setSecret(svc, KC_ACCESS_TOKEN, accessToken);
  await setSecret(svc, KC_REFRESH_TOKEN, refreshToken);
}

export async function storeSeatToken(userId: string, seatToken: string): Promise<void> {
  await setSecret(userService(userId), KC_SEAT_TOKEN, seatToken);
}

export async function loadFirmTokens(userId: string): Promise<StoredFirmTokens | null> {
  const svc = userService(userId);
  const accessToken = await getSecret(svc, KC_ACCESS_TOKEN);
  const refreshToken = await getSecret(svc, KC_REFRESH_TOKEN);
  if (!accessToken || !refreshToken) return null;
  const seatToken = await getSecret(svc, KC_SEAT_TOKEN);
  return { accessToken, refreshToken, seatToken };
}

export async function loadSeatToken(userId: string): Promise<string | null> {
  return getSecret(userService(userId), KC_SEAT_TOKEN);
}

export async function loadAccessToken(userId: string): Promise<string | null> {
  return getSecret(userService(userId), KC_ACCESS_TOKEN);
}

export async function loadRefreshToken(userId: string): Promise<string | null> {
  return getSecret(userService(userId), KC_REFRESH_TOKEN);
}

/** Wipe every secret for a user (sign-out / deprovision). */
export async function clearUserSecrets(userId: string): Promise<void> {
  const svc = userService(userId);
  await deleteSecret(svc, KC_ACCESS_TOKEN);
  await deleteSecret(svc, KC_REFRESH_TOKEN);
  await deleteSecret(svc, KC_SEAT_TOKEN);
}

// --- Per-matter content key -------------------------------------------------

export async function storeMatterKey(matterId: string, keyB64: string): Promise<void> {
  await setSecret(matterService(matterId), KC_MATTER_KEY, keyB64);
}

export async function loadMatterKey(matterId: string): Promise<string | null> {
  return getSecret(matterService(matterId), KC_MATTER_KEY);
}

export async function clearMatterKey(matterId: string): Promise<void> {
  await deleteSecret(matterService(matterId), KC_MATTER_KEY);
}
