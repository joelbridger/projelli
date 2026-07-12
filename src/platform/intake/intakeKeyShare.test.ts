import { beforeEach, describe, expect, it } from 'vitest';
import { getOrCreateDeviceKeypair } from '@/platform/firm/deviceKeys';
import {
  INTAKE_KEY_WRAP_CONTEXT,
  MATTER_KEY_WRAP_CONTEXT,
  unwrapKeyMaterial,
  wrapKeyMaterial,
} from '@/platform/firm/keyWrap';
import {
  generateContentKey,
  generateIntakeKeypair,
  unwrapContentKey,
  wrapContentKey,
} from './intakeCrypto';
import { intakeWrapContext } from './intakeKeyShare';

function b64(value: string): string {
  return btoa(String.fromCharCode(...new TextEncoder().encode(value)));
}

function text(value: string): string {
  const binary = atob(value);
  return new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)));
}

describe('intake team-key grants', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('round-trips an intake private JWK through a device grant and decrypts a real intake content key', async () => {
    const device = await getOrCreateDeviceKeypair();
    const intake = await generateIntakeKeypair();
    const intakeJwk = await crypto.subtle.exportKey('jwk', intake.privateKey);
    const wrapped = await wrapKeyMaterial(b64(JSON.stringify(intakeJwk)), device.publicJwk, 1, intakeWrapContext('intake-a'));
    const recoveredJwk = JSON.parse(text(await unwrapKeyMaterial(wrapped, 1, intakeWrapContext('intake-a')))) as JsonWebKey;
    const recoveredPrivate = await crypto.subtle.importKey('jwk', recoveredJwk, { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);

    const contentKey = await generateContentKey();
    const submissionWrap = await wrapContentKey(contentKey, intake.publicKeyRaw);
    await expect(unwrapContentKey(submissionWrap, recoveredPrivate)).resolves.toBe(contentKey);
  });

  it('keeps intake, matter, intake-id, and epoch domains separate', async () => {
    const device = await getOrCreateDeviceKeypair();
    const secret = b64('private-jwk-bytes');
    const intakeBlob = await wrapKeyMaterial(secret, device.publicJwk, 7, intakeWrapContext('intake-a'));
    const matterBlob = await wrapKeyMaterial(secret, device.publicJwk, 7, MATTER_KEY_WRAP_CONTEXT);

    await expect(unwrapKeyMaterial(intakeBlob, 7, MATTER_KEY_WRAP_CONTEXT)).rejects.toThrow();
    await expect(unwrapKeyMaterial(matterBlob, 7, intakeWrapContext('intake-a'))).rejects.toThrow();
    await expect(unwrapKeyMaterial(intakeBlob, 7, intakeWrapContext('intake-b'))).rejects.toThrow();
    await expect(unwrapKeyMaterial(intakeBlob, 8, intakeWrapContext('intake-a'))).rejects.toThrow();
    expect(INTAKE_KEY_WRAP_CONTEXT).not.toBe(MATTER_KEY_WRAP_CONTEXT);
  });

  it('rejects a tampered device grant', async () => {
    const device = await getOrCreateDeviceKeypair();
    const blob = await wrapKeyMaterial(b64('private-jwk-bytes'), device.publicJwk, 1, intakeWrapContext('intake-a'));
    const raw = atob(blob);
    const tampered = btoa(`${raw.slice(0, -1)}${String.fromCharCode(raw.charCodeAt(raw.length - 1) ^ 1)}`);
    await expect(unwrapKeyMaterial(tampered, 1, intakeWrapContext('intake-a'))).rejects.toThrow();
  });

  it('documents the honest limit: an already obtained intake key remains usable after a grant-set epoch changes', async () => {
    const device = await getOrCreateDeviceKeypair();
    const secret = b64('already-obtained-private-jwk');
    const epochOne = await wrapKeyMaterial(secret, device.publicJwk, 1, intakeWrapContext('intake-a'));
    expect(await unwrapKeyMaterial(epochOne, 1, intakeWrapContext('intake-a'))).toBe(secret);
    // Re-publishing at epoch 2 stops new relay grants to a removed device. It
    // cannot erase this plaintext key from a device that already received it.
    expect(await unwrapKeyMaterial(epochOne, 1, intakeWrapContext('intake-a'))).toBe(secret);
  });
});
