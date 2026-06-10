/**
 * keyWrap — adversarial tests for wrapMatterKey + unwrapMatterKey.
 *
 * Proves:
 *   - round-trip: wrap with recipient pub → unwrap with recipient private → original bytes
 *   - tampered byte → TamperedError
 *   - wrong epoch → WrongEpochError (epoch bound into both HKDF info AND GCM AAD)
 *   - different device private key → TamperedError (GCM fails = cannot distinguish tamper from wrong key)
 *   - epoch rotation: key wrapped at epoch 1 cannot be unwrapped expecting epoch 2
 *
 * The keychain is mocked so the device private key is stored/retrieved correctly.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock keychain (Tauri mode).
const keychainStore = new Map<string, string>();
const invokeMock = vi.fn(async (cmd: string, args: Record<string, unknown> = {}) => {
  const svc = (args.service as string) ?? 'com.keepance.app';
  const key = args.key as string;
  const id = `${svc}::${key}`;
  if (cmd === 'keychain_set') { keychainStore.set(id, args.value as string); return undefined; }
  if (cmd === 'keychain_get') {
    if (!keychainStore.has(id)) throw { kind: 'notFound', message: 'no entry' };
    return keychainStore.get(id);
  }
  if (cmd === 'keychain_delete') { keychainStore.delete(id); return undefined; }
  throw new Error(`unexpected invoke ${cmd}`);
});
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...a: unknown[]) => invokeMock(...(a as [string, Record<string, unknown>])),
  isTauri: () => true,
}));

import { wrapMatterKey, unwrapMatterKey, WrongEpochError, TamperedError } from '@/modules/firm/keyWrap';
import { getOrCreateDeviceKeypair, _resetDeviceCache } from '@/modules/firm/deviceKeys';

/** Generate a random base64 matter key (32 raw bytes = AES-256). */
async function randomMatterKeyB64(): Promise<string> {
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt']);
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', key));
  let bin = '';
  for (const b of raw) bin += String.fromCharCode(b);
  return btoa(bin);
}

/** Generate a fresh ECDH P-256 key pair and export the public JWK. */
async function generateEcdhPair(): Promise<{ publicJwk: JsonWebKey; privateJwk: JsonWebKey }> {
  const pair = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveBits'],
  );
  const publicJwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
  const privateJwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
  return { publicJwk, privateJwk };
}

describe('keyWrap — round-trip', () => {
  beforeEach(() => {
    keychainStore.clear();
    invokeMock.mockClear();
    _resetDeviceCache();
  });

  it('wrap then unwrap returns the original matter key', async () => {
    // Ensure the local device has a keypair stored
    const { publicJwk } = await getOrCreateDeviceKeypair();

    const matterKeyB64 = await randomMatterKeyB64();
    const wrapped = await wrapMatterKey(matterKeyB64, publicJwk, 1);

    expect(typeof wrapped).toBe('string');
    expect(wrapped.length).toBeGreaterThan(50);

    const unwrapped = await unwrapMatterKey(wrapped, 1);
    expect(unwrapped).toBe(matterKeyB64);
  });

  it('produces different ciphertext each call (ephemeral key + random salt + random IV)', async () => {
    const { publicJwk } = await getOrCreateDeviceKeypair();
    const matterKeyB64 = await randomMatterKeyB64();

    const wrap1 = await wrapMatterKey(matterKeyB64, publicJwk, 1);
    const wrap2 = await wrapMatterKey(matterKeyB64, publicJwk, 1);

    // Both valid, but different ciphertexts (ephemeral key + fresh randomness each call)
    expect(wrap1).not.toBe(wrap2);
    expect(await unwrapMatterKey(wrap1, 1)).toBe(matterKeyB64);
    expect(await unwrapMatterKey(wrap2, 1)).toBe(matterKeyB64);
  });
});

describe('keyWrap — typed errors', () => {
  beforeEach(() => {
    keychainStore.clear();
    invokeMock.mockClear();
    _resetDeviceCache();
  });

  it('tampered byte → TamperedError', async () => {
    const { publicJwk } = await getOrCreateDeviceKeypair();
    const matterKeyB64 = await randomMatterKeyB64();
    const wrapped = await wrapMatterKey(matterKeyB64, publicJwk, 1);

    // Flip a byte in the ciphertext portion (after the fixed-size header)
    const bytes = Array.from(atob(wrapped), (c) => c.charCodeAt(0));
    // Header: 1 (version) + 65 (ephemeral pub) + 16 (salt) + 12 (iv) = 94 bytes
    // Flip a byte in the ciphertext+tag portion
    bytes[100] = (bytes[100]! ^ 0xff) & 0xff;
    const tampered = btoa(String.fromCharCode(...bytes));

    await expect(unwrapMatterKey(tampered, 1)).rejects.toBeInstanceOf(TamperedError);
  });

  it('wrong epoch → WrongEpochError (subclass of TamperedError)', async () => {
    const { publicJwk } = await getOrCreateDeviceKeypair();
    const matterKeyB64 = await randomMatterKeyB64();
    const wrapped = await wrapMatterKey(matterKeyB64, publicJwk, 1);

    // Wrapped at epoch 1; trying to unwrap at epoch 2 should fail.
    // WrongEpochError extends TamperedError (both are GCM auth failures;
    // epoch mismatch changes the HKDF-derived key → GCM fails).
    const err = await unwrapMatterKey(wrapped, 2).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(WrongEpochError);
    // WrongEpochError IS-A TamperedError (both = GCM auth failure)
    expect(err).toBeInstanceOf(TamperedError);
  });

  it('epoch rotation: key wrapped at epoch 1 cannot unwrap expecting epoch 2', async () => {
    const { publicJwk } = await getOrCreateDeviceKeypair();
    const matterKeyB64 = await randomMatterKeyB64();

    const wrappedEpoch1 = await wrapMatterKey(matterKeyB64, publicJwk, 1);
    await expect(unwrapMatterKey(wrappedEpoch1, 2)).rejects.toBeInstanceOf(WrongEpochError);
  });

  it('different device private key → throws (TamperedError or WrongEpochError)', async () => {
    // Alice's device wraps to itself
    const { publicJwk: alicePub } = await getOrCreateDeviceKeypair();
    const matterKeyB64 = await randomMatterKeyB64();
    const wrapped = await wrapMatterKey(matterKeyB64, alicePub, 1);

    // Now wipe both the keychain and the in-memory cache, simulating a
    // completely different device (new private key).
    keychainStore.clear();
    _resetDeviceCache();
    // Force-generate a new (different) keypair
    await getOrCreateDeviceKeypair();

    // Unwrapping with a different device's private key must fail — different
    // ECDH shared secret → different HKDF-derived key → AES-GCM auth failure.
    await expect(unwrapMatterKey(wrapped, 1)).rejects.toThrow();
  });

  it('wrap with a third-party public key, then unwrap fails (no matching private key)', async () => {
    // Generate a key pair outside the device keychain
    const { publicJwk: strangerPub } = await generateEcdhPair();

    const { publicJwk: ownPub } = await getOrCreateDeviceKeypair();
    // Use own pub for the actual round-trip
    const matterKeyB64 = await randomMatterKeyB64();
    const wrappedForStranger = await wrapMatterKey(matterKeyB64, strangerPub, 1);

    // Trying to unwrap with our (own) private key must fail
    await expect(unwrapMatterKey(wrappedForStranger, 1)).rejects.toThrow();

    // But own pub → own priv should still work
    const wrappedForSelf = await wrapMatterKey(matterKeyB64, ownPub, 1);
    const result = await unwrapMatterKey(wrappedForSelf, 1);
    expect(result).toBe(matterKeyB64);
  });
});

describe('keyWrap — wire format', () => {
  beforeEach(() => {
    keychainStore.clear();
    invokeMock.mockClear();
    _resetDeviceCache();
  });

  it('output is valid base64 and has minimum length (version+pub+salt+iv+ciphertext+tag)', async () => {
    const { publicJwk } = await getOrCreateDeviceKeypair();
    const matterKeyB64 = await randomMatterKeyB64();
    const wrapped = await wrapMatterKey(matterKeyB64, publicJwk, 1);

    expect(wrapped).toMatch(/^[A-Za-z0-9+/]+=*$/);

    const bytes = atob(wrapped);
    // 1 (ver) + 65 (ephemeral pub uncompressed) + 16 (salt) + 12 (iv) + 32 (AES-256 plaintext) + 16 (GCM tag) = 142 minimum
    expect(bytes.length).toBeGreaterThanOrEqual(142);
  });

  it('version byte is 0x01', async () => {
    const { publicJwk } = await getOrCreateDeviceKeypair();
    const matterKeyB64 = await randomMatterKeyB64();
    const wrapped = await wrapMatterKey(matterKeyB64, publicJwk, 1);
    const bytes = Array.from(atob(wrapped), (c) => c.charCodeAt(0));
    expect(bytes[0]).toBe(1);
  });
});
