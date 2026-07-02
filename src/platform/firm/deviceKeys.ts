/**
 * deviceKeys — per-device ECDH P-256 keypair management.
 *
 * Each Advisor Prep Hero installation generates ONE ECDH P-256 keypair. The PUBLIC key
 * is registered with the firm backend (POST /device/register) so other members
 * can wrap matter keys to this device. The PRIVATE key never leaves this
 * machine.
 *
 * Key storage:
 *   On Tauri (production), the private key is stored NON-EXTRACTABLE in the
 *   WebCrypto key store and the wrapped-JWK blob is persisted in the OS
 *   keychain at service `com.lantern.device.<device_id>`, key `private_jwk`.
 *   Because the keychain accepts strings, we export the private key as JWK
 *   and import it back as non-extractable on load.
 *
 *   BROWSER / DEV / TEST CAVEAT: jsdom and most browser contexts DO support
 *   exportKey on P-256 keys even when created non-extractable in the WC API
 *   (the behaviour varies by implementation). We export the private JWK for
 *   persistence in all environments, matching the firmKeychain.ts fallback
 *   posture: the OS keychain is the real security boundary on production
 *   Tauri installs; the localStorage fallback is a testability affordance only.
 *
 * Device ID:
 *   A stable UUID generated once and persisted alongside the private key in
 *   the keychain (service `com.lantern.device.<device_id>`, key `device_id`).
 *   We use a UUIDv4-shaped string from crypto.getRandomValues.
 */

import { keychainGet, keychainSet } from '@/platform/utils/tauri-commands';
import { isTauri } from '@tauri-apps/api/core';
import { FirmApiClient } from './FirmApiClient';
import { KC_DEVICE_META_SERVICE, KC_DEVICE_PREFIX, KC_FALLBACK_PREFIX } from '@/config/identity';

// ── Service names & keychain keys -------------------------------------------

const DEVICE_META_SERVICE = KC_DEVICE_META_SERVICE;
const KC_DEVICE_ID = 'device_id';
const KC_PRIVATE_JWK_PREFIX = KC_DEVICE_PREFIX;
const KC_PRIVATE_JWK_KEY = 'private_jwk';
const KC_PUBLIC_JWK_KEY = 'public_jwk';

function fallbackAvailable(): boolean {
  return typeof localStorage !== 'undefined';
}
function fallbackKey(service: string, key: string): string {
  return `${KC_FALLBACK_PREFIX}${service}::${key}`;
}
function utf8ToB64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}
function b64ToUtf8(b64: string): string {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

async function persistSecret(service: string, key: string, value: string): Promise<void> {
  if (isTauri()) {
    await keychainSet(key, value, service);
    return;
  }
  if (fallbackAvailable()) {
    localStorage.setItem(fallbackKey(service, key), utf8ToB64(value));
    return;
  }
  throw new Error('No secret storage available (not Tauri, no localStorage).');
}

async function readSecret(service: string, key: string): Promise<string | null> {
  if (isTauri()) {
    try {
      return await keychainGet(key, service);
    } catch {
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

// ── UUID generation ---------------------------------------------------------

function generateUuid(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  // RFC 4122 version 4 variant
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// ── In-memory cache (one keypair per process lifetime) ----------------------

let cachedDeviceId: string | null = null;
let cachedPublicJwk: JsonWebKey | null = null;
let cachedPrivateCryptoKey: CryptoKey | null = null;

/**
 * Promise-singleton for getOrCreateDeviceKeypair: cached at function ENTRY so
 * concurrent awaits share one construction and never double-generate or
 * double-write the keypair. Cleared on resolution so a crash-retry can restart.
 */
let pendingKeypair: Promise<{ deviceId: string; publicJwk: JsonWebKey }> | null = null;

// ── Public API --------------------------------------------------------------

/**
 * Return this device's stable ECDH P-256 keypair, creating and persisting one
 * if none exists. The private key is stored in the OS keychain (Tauri) or the
 * localStorage fallback (dev/test). The public JWK is safe to share; the
 * private key is never returned to callers (only used internally by keyWrap.ts
 * via getDevicePrivateKey).
 *
 * Singleton: concurrent calls share a single construction promise so React
 * StrictMode double-effects and overlapping startup paths never double-generate
 * the device keypair or write conflicting entries to the keychain.
 */
export function getOrCreateDeviceKeypair(): Promise<{
  deviceId: string;
  publicJwk: JsonWebKey;
}> {
  // Fast path: already resolved in memory.
  if (cachedDeviceId && cachedPublicJwk) {
    return Promise.resolve({ deviceId: cachedDeviceId, publicJwk: cachedPublicJwk });
  }

  // Return in-flight promise if one exists.
  if (pendingKeypair) return pendingKeypair;

  pendingKeypair = _loadOrCreateDeviceKeypair().then(
    (result) => { pendingKeypair = null; return result; },
    (err) => { pendingKeypair = null; throw err; },
  );
  return pendingKeypair;
}

async function _loadOrCreateDeviceKeypair(): Promise<{
  deviceId: string;
  publicJwk: JsonWebKey;
}> {
  // Fast path: already in memory (may have resolved between the outer check and here).
  if (cachedDeviceId && cachedPublicJwk) {
    return { deviceId: cachedDeviceId, publicJwk: cachedPublicJwk };
  }

  // Try to load from keychain.
  const storedDeviceId = await readSecret(DEVICE_META_SERVICE, KC_DEVICE_ID);
  if (storedDeviceId) {
    const privService = `${KC_PRIVATE_JWK_PREFIX}${storedDeviceId}`;
    const privJwkStr = await readSecret(privService, KC_PRIVATE_JWK_KEY);
    const pubJwkStr = await readSecret(privService, KC_PUBLIC_JWK_KEY);

    if (privJwkStr && pubJwkStr) {
      const privJwk = JSON.parse(privJwkStr) as JsonWebKey;
      const publicJwk = JSON.parse(pubJwkStr) as JsonWebKey;

      // Re-import the private key as non-extractable.
      const privateCryptoKey = await crypto.subtle.importKey(
        'jwk',
        privJwk,
        { name: 'ECDH', namedCurve: 'P-256' },
        false, // non-extractable
        ['deriveBits'],
      );

      cachedDeviceId = storedDeviceId;
      cachedPublicJwk = publicJwk;
      cachedPrivateCryptoKey = privateCryptoKey;

      return { deviceId: storedDeviceId, publicJwk };
    }
  }

  // Generate a new keypair.
  const pair = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true, // must be extractable for persistence
    ['deriveBits'],
  );

  const publicJwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
  const privateJwk = await crypto.subtle.exportKey('jwk', pair.privateKey);

  const deviceId = generateUuid();
  const privService = `${KC_PRIVATE_JWK_PREFIX}${deviceId}`;

  // Persist everything.
  await persistSecret(DEVICE_META_SERVICE, KC_DEVICE_ID, deviceId);
  await persistSecret(privService, KC_PRIVATE_JWK_KEY, JSON.stringify(privateJwk));
  await persistSecret(privService, KC_PUBLIC_JWK_KEY, JSON.stringify(publicJwk));

  // Re-import private key as non-extractable for the in-memory cache.
  const privateCryptoKey = await crypto.subtle.importKey(
    'jwk',
    privateJwk,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    ['deriveBits'],
  );

  cachedDeviceId = deviceId;
  cachedPublicJwk = publicJwk;
  cachedPrivateCryptoKey = privateCryptoKey;

  return { deviceId, publicJwk };
}

/**
 * Return this device's non-extractable ECDH private CryptoKey. Throws
 * NoDeviceKeyError if no keypair has been created yet (call
 * getOrCreateDeviceKeypair first).
 */
export async function getDevicePrivateKey(): Promise<CryptoKey> {
  // Ensure loaded.
  await getOrCreateDeviceKeypair();
  if (!cachedPrivateCryptoKey) {
    throw new Error('NoDeviceKeyError: device private key not available.');
  }
  return cachedPrivateCryptoKey;
}

/**
 * Register this device with the firm backend. Idempotent: calling it multiple
 * times is safe (the server must tolerate duplicate device_ids from the same
 * user). The same keypair is always used.
 *
 * Sends: POST /device/register { device_id, machine_id, label, pubkey_jwk }
 */
export async function registerDevice(client: FirmApiClient): Promise<void> {
  const { deviceId, publicJwk } = await getOrCreateDeviceKeypair();

  // machine_id and label are best-effort; they help the admin identify devices.
  const machineId = deviceId; // Use deviceId as stable machine_id (no Tauri machine API needed)
  const label = typeof navigator !== 'undefined' ? navigator.userAgent.slice(0, 80) : 'Advisor Prep Hero Desktop';

  await client.registerDevice(deviceId, machineId, label, publicJwk);
}

/** Reset the in-memory cache (for testing only). */
export function _resetDeviceCache(): void {
  cachedDeviceId = null;
  cachedPublicJwk = null;
  cachedPrivateCryptoKey = null;
}
