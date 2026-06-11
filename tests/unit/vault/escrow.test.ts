/**
 * escrow.test.ts — destructive spec §13 item 10.
 *
 * Proves that the VMK escrow round-trip works end-to-end via the real
 * WebCrypto implementation of keyWrap (ECDH P-256 + HKDF-SHA256 + AES-256-GCM).
 *
 * The keychain is mocked (same pattern as keyWrap.test.ts) so the device
 * keypair is stored and retrieved correctly in JSDOM.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock keychain (Tauri mode) ──────────────────────────────────────────────
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

import { wrapMatterKey, unwrapMatterKey } from '@/modules/firm/keyWrap';
import { getOrCreateDeviceKeypair, _resetDeviceCache } from '@/modules/firm/deviceKeys';

describe('vault escrow reuses keyWrap', () => {
  beforeEach(() => {
    keychainStore.clear();
    invokeMock.mockClear();
    _resetDeviceCache();
  });

  it('wraps the VMK to an admin device pubkey and the admin unwraps it', async () => {
    // The "admin device" is represented by the current device keypair.
    // In production, provisionEscrow calls vault_export_vmk_for_escrow (Rust)
    // to get the VMK, then wrapMatterKey to each admin's public key.
    _resetDeviceCache();
    const { publicJwk } = await getOrCreateDeviceKeypair(); // this "device" is the admin

    // Build a fake 32-byte VMK (all 0x07) and encode it to base64 the same
    // way vault_export_vmk_for_escrow returns it (raw bytes, base64-encoded).
    const vmkB64 = btoa(String.fromCharCode(...new Uint8Array(32).fill(7)));

    // Wrap the VMK to the admin's public key at epoch 1.
    const wrapped = await wrapMatterKey(vmkB64, publicJwk, 1);
    expect(typeof wrapped).toBe('string');
    expect(wrapped.length).toBeGreaterThan(50);

    // Unwrap using the admin's private key (stored in the in-memory + keychain cache).
    const recovered = await unwrapMatterKey(wrapped, 1);
    expect(recovered).toBe(vmkB64);
  });

  it('wraps to a third-party pubkey that cannot be unwrapped by another device', async () => {
    // Admin A wraps the VMK to admin B's public key.
    // Admin A's device cannot unwrap it (wrong private key).
    const pair = await crypto.subtle.generateKey(
      { name: 'ECDH', namedCurve: 'P-256' },
      true,
      ['deriveBits'],
    );
    const adminBPubJwk = await crypto.subtle.exportKey('jwk', pair.publicKey);

    const vmkB64 = btoa(String.fromCharCode(...new Uint8Array(32).fill(42)));

    // Wrap to admin B's public key.
    const wrapped = await wrapMatterKey(vmkB64, adminBPubJwk, 1);

    // Admin A (the current device, with a different private key) cannot unwrap it.
    _resetDeviceCache();
    await getOrCreateDeviceKeypair(); // generates a new (admin A) device key
    await expect(unwrapMatterKey(wrapped, 1)).rejects.toThrow();
  });

  it('epoch is bound: VMK wrapped at epoch 1 cannot be recovered at epoch 2', async () => {
    _resetDeviceCache();
    const { publicJwk } = await getOrCreateDeviceKeypair();

    const vmkB64 = btoa(String.fromCharCode(...new Uint8Array(32).fill(99)));
    const wrapped = await wrapMatterKey(vmkB64, publicJwk, 1);

    // Same device, wrong epoch.
    await expect(unwrapMatterKey(wrapped, 2)).rejects.toThrow();
  });
});
