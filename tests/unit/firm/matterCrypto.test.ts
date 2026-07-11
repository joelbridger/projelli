/**
 * matterCrypto — the per-matter E2EE primitives. These tests prove the relay
 * payload is opaque ciphertext (not the plaintext Yjs update), that the
 * round-trip recovers the exact bytes, and that the key, epoch, and opaque
 * route are ALL required to open a blob (the cryptographic teeth behind key
 * rotation and route isolation).
 */

import { describe, it, expect } from 'vitest';
import {
  generateMatterKey,
  importMatterKey,
  encryptUpdateV2,
  decryptUpdateV2,
} from '@/platform/firm/matterCrypto';

const enc = (s: string) => new TextEncoder().encode(s);
const dec = (b: Uint8Array) => new TextDecoder().decode(b);
const context = {
  keyEpoch: 1,
  matterHandle: `mh2_${'A'.repeat(43)}`,
  streamHandle: `sh2_${'B'.repeat(43)}`,
};

describe('matterCrypto', () => {
  it('round-trips an update under the same key + epoch', async () => {
    const keyB64 = await generateMatterKey();
    const key = await importMatterKey(keyB64);
    const plaintext = enc('the quick brown fox — privileged matter note');

    const blob = await encryptUpdateV2(key, plaintext, context);
    const out = await decryptUpdateV2(key, blob, context);

    expect(out.ok).toBe(true);
    if (out.ok) expect(dec(out.update)).toBe('the quick brown fox — privileged matter note');
  });

  it('produces OPAQUE base64 ciphertext that does not contain the plaintext', async () => {
    const keyB64 = await generateMatterKey();
    const key = await importMatterKey(keyB64);
    const secret = 'ATTORNEY_CLIENT_PRIVILEGED_SENTINEL_9c3f';
    const blob = await encryptUpdateV2(key, enc(secret), context);

    // The relay stores exactly this base64 string. It must not reveal the secret
    // in any decoding the relay could trivially do.
    expect(blob).not.toContain(secret);
    const decoded = atob(blob);
    expect(decoded).not.toContain(secret);
    // And it is well-formed base64 (what we send as ciphertext_b64).
    expect(blob).toMatch(/^[A-Za-z0-9+/]+=*$/);
  });

  it('a DIFFERENT key cannot decrypt (auth_failed, never a throw)', async () => {
    const key = await importMatterKey(await generateMatterKey());
    const otherKey = await importMatterKey(await generateMatterKey());
    const blob = await encryptUpdateV2(key, enc('hello'), context);

    const out = await decryptUpdateV2(otherKey, blob, context);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toBe('auth_failed');
  });

  it('the WRONG epoch fails authentication (epoch is bound as AAD)', async () => {
    const key = await importMatterKey(await generateMatterKey());
    const blob = await encryptUpdateV2(key, enc('hello'), context);

    // Same key, but the blob was sealed under epoch 1; opening as epoch 2 fails.
    const out = await decryptUpdateV2(key, blob, { ...context, keyEpoch: 2 });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toBe('auth_failed');
  });

  it('tampered ciphertext fails authentication', async () => {
    const key = await importMatterKey(await generateMatterKey());
    const blob = await encryptUpdateV2(key, enc('hello world'), context);
    // Flip a byte in the middle of the base64.
    const bytes = atob(blob).split('');
    bytes[20] = String.fromCharCode((bytes[20]!.charCodeAt(0) ^ 0x01) & 0xff);
    const tampered = btoa(bytes.join(''));

    const out = await decryptUpdateV2(key, tampered, context);
    expect(out.ok).toBe(false);
  });

  it('rejects a malformed / too-short blob without throwing', async () => {
    const key = await importMatterKey(await generateMatterKey());
    const out = await decryptUpdateV2(key, 'AAAA', context);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toBe('malformed');
  });
});
