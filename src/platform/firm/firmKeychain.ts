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

import { keychainGet, keychainSet, keychainDelete } from '@/platform/utils/tauri-commands';
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
  matterHandle: string;
  rootStreamHandle: string;
  keyEpoch: number;
  keyB64: string;
  rootBlobId: string;
  rootCiphertextB64: string;
}

function promotionService(localMatterId: string): string {
  return `com.lantern.matter-promotion.${localMatterId}`;
}

export async function storePromotionPending(localMatterId: string, record: PromotionPendingRecord): Promise<void> {
  await setSecret(promotionService(localMatterId), KC_PROMOTION_PENDING, JSON.stringify(record));
}

export async function loadPromotionPending(localMatterId: string): Promise<PromotionPendingRecord | null> {
  const raw = await getSecret(promotionService(localMatterId), KC_PROMOTION_PENDING);
  if (!raw) return null;
  try {
    const record = JSON.parse(raw) as PromotionPendingRecord;
    if (typeof record.matterHandle !== 'string' || typeof record.rootStreamHandle !== 'string' ||
      !Number.isInteger(record.keyEpoch) || typeof record.keyB64 !== 'string' ||
      typeof record.rootBlobId !== 'string' || typeof record.rootCiphertextB64 !== 'string') return null;
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
