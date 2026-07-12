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

import { keychainCompareAndSet, keychainGet, keychainSet, keychainDelete } from '@/platform/utils/tauri-commands';
import { isTauri } from '@tauri-apps/api/core';
import { kcUserService, kcMatterService, KC_FALLBACK_PREFIX } from '@/config/identity';

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

/**
 * A local crash/retry ledger for sharing a client. It is secret storage because
 * it contains the content key and encrypted first write; the relay sees only
 * its opaque handles and ciphertext. Keeping it until a success or confirmed
 * archive prevents a timeout from creating an unreachable second shell.
 */
export interface PromotionPendingRecord {
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
  orgId?: string;
  /** Short durable ownership lease. It is never a substitute for the receipt. */
  leaseOwnerId?: string;
  leaseExpiresAt?: number;
}

function promotionService(localMatterId: string): string {
  return `com.lantern.matter-promotion.${localMatterId}`;
}

export async function storePromotionPending(localMatterId: string, record: PromotionPendingRecord): Promise<void> {
  // A checkpoint write must never drop the lease. Callers rebuild this record as
  // they learn each field, and a caller that omitted `leaseOwnerId` used to erase
  // it — after which completePromotionPending found no owner and refused the
  // window's OWN work ("another window is finishing this"), so every share failed.
  // Preserve the lease here rather than trusting every present and future caller
  // to remember it.
  const existing = await rawPromotionPending(localMatterId);
  let next = record;
  if (existing && record.leaseOwnerId === undefined) {
    try {
      const current = JSON.parse(existing) as PromotionPendingRecord;
      if (current.leaseOwnerId !== undefined) {
        next = {
          ...record,
          leaseOwnerId: current.leaseOwnerId,
          ...(current.leaseExpiresAt === undefined ? {} : { leaseExpiresAt: current.leaseExpiresAt }),
        };
      }
    } catch {
      // A corrupted record is handled by the claim path; write the new one as-is.
    }
  }
  await setSecret(promotionService(localMatterId), KC_PROMOTION_PENDING, JSON.stringify(next));
}

const PROMOTION_LEASE_MS = 30_000;

function newLeaseOwnerId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function validPromotionRecord(value: unknown): value is PromotionPendingRecord {
  if (!value || typeof value !== 'object') return false;
  const record = value as PromotionPendingRecord;
  return typeof record.provisioningNonce === 'string';
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
  if (locks) return locks.request(`lantern-promotion:${localMatterId}`, { mode: 'exclusive' }, run);
  // Test-only/non-browser fallback. Real desktop never reaches this path.
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
export async function claimPromotionPending(localMatterId: string): Promise<PromotionClaim> {
  const ownerId = newLeaseOwnerId();
  for (;;) {
    const raw = await rawPromotionPending(localMatterId);
    const now = Date.now();
    if (!raw) {
      const record: PromotionPendingRecord = {
        provisioningNonce: `pn2_${base64UrlRandom(32)}`,
        leaseOwnerId: ownerId,
        leaseExpiresAt: now + PROMOTION_LEASE_MS,
      };
      const result = await compareAndSetPromotionPending(localMatterId, null, record);
      if (result.swapped) return { record, ownerId, owned: true };
      continue;
    }
    let record: PromotionPendingRecord;
    try { record = JSON.parse(raw) as PromotionPendingRecord; } catch { throw new Error('The saved sharing retry record is corrupted.'); }
    if (!validPromotionRecord(record)) throw new Error('The saved sharing retry record is corrupted.');
    if (record.completed) return { record, ownerId, owned: false };
    if (typeof record.leaseExpiresAt === 'number' && record.leaseExpiresAt > now && record.leaseOwnerId) {
      return { record, ownerId, owned: false };
    }
    // A crashed owner may be replaced only by preserving every checkpoint,
    // especially the provisioning nonce/opaque handle/key recovery material.
    const adopted = { ...record, leaseOwnerId: ownerId, leaseExpiresAt: now + PROMOTION_LEASE_MS };
    const result = await compareAndSetPromotionPending(localMatterId, raw, adopted);
    if (result.swapped) return { record: adopted, ownerId, owned: true };
  }
}

/** Give up the short execution lease without deleting recovery material. */
export async function releasePromotionPendingLease(
  localMatterId: string,
  ownerId: string,
): Promise<void> {
  const raw = await rawPromotionPending(localMatterId);
  if (!raw) return;
  try {
    const record = JSON.parse(raw) as PromotionPendingRecord;
    if (record.leaseOwnerId !== ownerId || record.completed) return;
    const { leaseOwnerId: _leaseOwnerId, leaseExpiresAt: _leaseExpiresAt, ...unleased } = record;
    await compareAndSetPromotionPending(localMatterId, raw, unleased);
  } catch {
    // A corrupt receipt is handled by the explicit load/claim error path.
  }
}

/** Keep a compact terminal receipt so another window can adopt its linkage. */
export async function completePromotionPending(
  localMatterId: string,
  ownerId: string,
  record: PromotionPendingRecord,
  orgId: string,
): Promise<void> {
  const raw = await rawPromotionPending(localMatterId);
  if (!raw) throw new Error('The saved sharing retry record disappeared.');
  const current = JSON.parse(raw) as PromotionPendingRecord;
  if (current.leaseOwnerId !== ownerId) throw new Error('Another window is finishing this shared client.');
  const terminal: PromotionPendingRecord = {
    provisioningNonce: record.provisioningNonce,
    matterHandle: record.matterHandle!,
    rootStreamHandle: record.rootStreamHandle!,
    keyEpoch: record.keyEpoch!,
    rootWriteAccepted: true,
    completed: true,
    orgId,
  };
  const result = await compareAndSetPromotionPending(localMatterId, raw, terminal);
  if (!result.swapped) throw new Error('Another window is finishing this shared client.');
}

function base64UrlRandom(byteCount: number): string {
  const bytes = new Uint8Array(byteCount);
  crypto.getRandomValues(bytes);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/u, '');
}

export async function loadPromotionPending(localMatterId: string): Promise<PromotionPendingRecord | null> {
  const raw = await getSecret(promotionService(localMatterId), KC_PROMOTION_PENDING);
  if (!raw) return null;
  try {
    const record = JSON.parse(raw) as PromotionPendingRecord;
    if (typeof record.provisioningNonce !== 'string') return null;
    const hasProvision = typeof record.matterHandle === 'string' && typeof record.rootStreamHandle === 'string' && Number.isInteger(record.keyEpoch);
    const hasAnyProvision = record.matterHandle !== undefined || record.rootStreamHandle !== undefined || record.keyEpoch !== undefined;
    const hasCrypto = typeof record.keyB64 === 'string' && typeof record.rootBlobId === 'string' && typeof record.rootCiphertextB64 === 'string';
    const hasAnyCrypto = record.keyB64 !== undefined || record.rootBlobId !== undefined || record.rootCiphertextB64 !== undefined;
    if (record.rootWriteAccepted !== undefined && typeof record.rootWriteAccepted !== 'boolean') return null;
    // There are three safe checkpoints: nonce-only before the request;
    // provisioned handles before key/index work; and the complete encrypted
    // root write. Anything between those shapes is corruption, not a state to
    // guess through.
    if ((hasAnyProvision && !hasProvision) || (hasAnyCrypto && (!hasCrypto || !hasProvision))) return null;
    return record;
  } catch {
    return null;
  }
}

export async function clearPromotionPending(localMatterId: string): Promise<void> {
  await deleteSecret(promotionService(localMatterId), KC_PROMOTION_PENDING);
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
