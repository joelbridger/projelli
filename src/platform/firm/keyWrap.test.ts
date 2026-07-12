import { beforeEach, describe, expect, it } from 'vitest';
import { getDevicePrivateKey, getOrCreateDeviceKeypair } from './deviceKeys';
import { MATTER_KEY_WRAP_CONTEXT, unwrapMatterKey } from './keyWrap';

function b64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

async function wrapWithOriginalMatterWireForm(secret: Uint8Array, epoch: number): Promise<string> {
  const recipient = await getOrCreateDeviceKeypair();
  const subtle = crypto.subtle;
  const ephemeral = await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const recipientPublic = await subtle.importKey('jwk', recipient.publicJwk, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const shared = await subtle.deriveBits({ name: 'ECDH', public: recipientPublic }, ephemeral.privateKey, 256);
  const hkdf = await subtle.importKey('raw', shared, { name: 'HKDF' }, false, ['deriveKey']);
  const key = await subtle.deriveKey({
    name: 'HKDF', hash: 'SHA-256', salt,
    info: new TextEncoder().encode(`${MATTER_KEY_WRAP_CONTEXT}:epoch:${String(epoch)}`),
  }, hkdf, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  const ciphertext = new Uint8Array(await subtle.encrypt({
    name: 'AES-GCM', iv,
    // This is deliberately the pre-intake-sharing persisted AAD form.
    additionalData: new TextEncoder().encode(`epoch:${String(epoch)}`),
  }, key, secret));
  const publicRaw = new Uint8Array(await subtle.exportKey('raw', ephemeral.publicKey));
  const wire = new Uint8Array(1 + publicRaw.length + salt.length + iv.length + ciphertext.length);
  wire[0] = 1;
  wire.set(publicRaw, 1);
  wire.set(salt, 66);
  wire.set(iv, 82);
  wire.set(ciphertext, 94);
  return b64(wire);
}

describe('matter-key wrap wire compatibility', () => {
  beforeEach(async () => {
    localStorage.clear();
    await getOrCreateDeviceKeypair();
  });

  it('opens a persisted matter blob sealed with the original epoch-only AAD', async () => {
    const original = crypto.getRandomValues(new Uint8Array(32));
    const wire = await wrapWithOriginalMatterWireForm(original, 4);
    const opened = await unwrapMatterKey(wire, 4);
    expect(opened).toBe(b64(original));
    await expect(getDevicePrivateKey()).resolves.toBeDefined();
  });
});
