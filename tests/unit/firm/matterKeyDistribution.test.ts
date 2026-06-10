/**
 * matterKeyDistribution — integration tests for publishMatterKeyToMembers
 * and obtainMatterKey, all against a mocked FirmApiClient.
 *
 * Adversarial cases:
 *   - 403 → null and keychain untouched
 *   - 404 → null
 *   - walled member's device never appears in publish payload
 *   - escrow: every org admin's devices appear in publish payload even if
 *     they are not matter members
 *   - success path stores the unwrapped key in the keychain
 *   - epoch rotation: publishMatterKeyToMembers uses the CURRENT epoch
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

// ── Mock CORS-safe fetch — the FirmApiClient stubs calls made via publishMatterKeyToMembers
// / obtainMatterKey won't use it (we mock the FirmApiClient methods directly instead).
const fetchMock = vi.fn();
vi.mock('@/modules/models/fetchUtils', () => ({
  getCorsSafeFetch: async () => fetchMock as unknown as typeof fetch,
}));

import { FirmApiClient, FirmApiError } from '@/modules/firm/FirmApiClient';
import { publishMatterKeyToMembers, obtainMatterKey } from '@/modules/firm/matterKeyService';
import { storeMatterKey, loadMatterKey } from '@/modules/firm/firmKeychain';
import { getOrCreateDeviceKeypair, _resetDeviceCache } from '@/modules/firm/deviceKeys';
import { generateMatterKey } from '@/modules/firm/matterCrypto';

// ── Helpers to generate ECDH P-256 key pairs for test "member devices"
async function generateMemberKeyPair(): Promise<{ publicJwk: JsonWebKey; privateJwk: JsonWebKey }> {
  const pair = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveBits'],
  );
  return {
    publicJwk: await crypto.subtle.exportKey('jwk', pair.publicKey),
    privateJwk: await crypto.subtle.exportKey('jwk', pair.privateKey),
  };
}

// ── Minimal mock FirmApiClient factory.
// We spy on specific methods rather than mocking the transport.
function mockClient(): FirmApiClient {
  return new FirmApiClient();
}

describe('publishMatterKeyToMembers', () => {
  beforeEach(() => {
    keychainStore.clear();
    fetchMock.mockReset();
    invokeMock.mockClear();
    _resetDeviceCache();
  });

  it('publishes to members and excludes walled users', async () => {
    // Pre-store a matter key on this device
    const matterKeyB64 = await generateMatterKey();
    await storeMatterKey('matter-1', matterKeyB64);

    // Ensure this device has a keypair
    const { publicJwk: thisDevicePub, deviceId: thisDeviceId } = await getOrCreateDeviceKeypair();

    // Two "member" devices: alice (not walled) and bob (walled)
    const alice = await generateMemberKeyPair();
    const bob = await generateMemberKeyPair();

    const client = mockClient();

    // Stub listMatterMembers: alice is a member, bob is both a member AND walled
    vi.spyOn(client, 'listMatterMembers').mockResolvedValue({
      matter_id: 'matter-1',
      key_epoch: 1,
      members: [
        { matter_id: 'matter-1', user_id: 'alice', org_id: 'org-1', role: 'editor', created_at: '' },
        { matter_id: 'matter-1', user_id: 'bob', org_id: 'org-1', role: 'editor', created_at: '' },
      ],
      walls: [
        { matter_id: 'matter-1', user_id: 'bob', org_id: 'org-1', reason: 'conflict', created_by: 'admin', created_at: '' },
      ],
    });

    // Stub fetchOrgUserDevices: return devices for alice + bob
    vi.spyOn(client, 'fetchOrgUserDevices').mockResolvedValue({
      devices: [
        { user_id: 'alice', device_id: 'alice-device-1', pubkey_jwk: alice.publicJwk, label: 'Alice laptop' },
        { user_id: 'bob', device_id: 'bob-device-1', pubkey_jwk: bob.publicJwk, label: 'Bob laptop' },
      ],
    });

    // No admin escrow in this test variant
    vi.spyOn(client, 'listOrgAdmins').mockResolvedValue({ admins: [] });

    let publishPayload: { epoch: number; wrapped: Array<{ user_id: string; device_id: string; wrapped_key_b64: string }> } | null = null;
    vi.spyOn(client, 'publishMatterKeys').mockImplementation(async (_matterId, payload) => {
      publishPayload = payload;
      return { ok: true, stored: payload.wrapped.length };
    });

    const result = await publishMatterKeyToMembers(client, 'matter-1', 1);

    // alice's device got a wrapped key; bob's did NOT (walled)
    expect(publishPayload).not.toBeNull();
    const wrappedFor = publishPayload!.wrapped.map((w) => w.user_id);
    expect(wrappedFor).toContain('alice');
    expect(wrappedFor).not.toContain('bob');

    expect(result.skippedWalled).toBe(1);
    expect(result.published).toBe(publishPayload!.wrapped.length);
  });

  it('includes org admin devices as escrow even if admin is not a matter member', async () => {
    const matterKeyB64 = await generateMatterKey();
    await storeMatterKey('matter-escrow', matterKeyB64);

    const member = await generateMemberKeyPair();
    const admin = await generateMemberKeyPair();

    const client = mockClient();

    vi.spyOn(client, 'listMatterMembers').mockResolvedValue({
      matter_id: 'matter-escrow',
      key_epoch: 1,
      members: [
        { matter_id: 'matter-escrow', user_id: 'member-user', org_id: 'org-1', role: 'editor', created_at: '' },
        // admin-user is NOT listed as a member — should still be included via escrow
      ],
      walls: [],
    });

    vi.spyOn(client, 'fetchOrgUserDevices').mockImplementation(async (userIds: string[]) => {
      const allDevices: Array<{ user_id: string; device_id: string; pubkey_jwk: JsonWebKey; label: string }> = [];
      if (userIds.includes('member-user')) {
        allDevices.push({ user_id: 'member-user', device_id: 'member-d1', pubkey_jwk: member.publicJwk, label: 'member laptop' });
      }
      if (userIds.includes('admin-user')) {
        allDevices.push({ user_id: 'admin-user', device_id: 'admin-d1', pubkey_jwk: admin.publicJwk, label: 'admin laptop' });
      }
      return { devices: allDevices };
    });

    // Stub listOrgAdmins (admin escrow)
    vi.spyOn(client, 'listOrgAdmins').mockResolvedValue({
      admins: [{ user_id: 'admin-user', email: 'admin@firm.com', role: 'admin' }],
    });

    let publishPayload: { wrapped: Array<{ user_id: string }> } | null = null;
    vi.spyOn(client, 'publishMatterKeys').mockImplementation(async (_matterId, payload) => {
      publishPayload = payload;
      return { ok: true, stored: payload.wrapped.length };
    });

    await publishMatterKeyToMembers(client, 'matter-escrow', 1);

    const wrappedFor = publishPayload!.wrapped.map((w) => w.user_id);
    expect(wrappedFor).toContain('member-user');
    // Admin gets escrow copy even though not a matter member
    expect(wrappedFor).toContain('admin-user');
  });

  it('throws if no local matter key exists (caller must be the holder)', async () => {
    const client = mockClient();
    // No matter key stored for this matter — publishMatterKeyToMembers should
    // throw before making any network calls.
    await expect(publishMatterKeyToMembers(client, 'matter-missing', 1)).rejects.toThrow(
      /no local matter key/i,
    );
  });
});

describe('obtainMatterKey', () => {
  beforeEach(() => {
    keychainStore.clear();
    fetchMock.mockReset();
    invokeMock.mockClear();
    _resetDeviceCache();
  });

  it('returns from local keychain if key already stored', async () => {
    const matterKeyB64 = await generateMatterKey();
    await storeMatterKey('matter-local', matterKeyB64);

    const client = mockClient();
    const fetchKeysSpy = vi.spyOn(client, 'fetchMatterKeys');

    const result = await obtainMatterKey(client, 'matter-local');

    expect(result).toBe(matterKeyB64);
    // Should NOT have made a network call
    expect(fetchKeysSpy).not.toHaveBeenCalled();
  });

  it('403 → returns null and does NOT store anything in the keychain', async () => {
    const client = mockClient();
    vi.spyOn(client, 'fetchMatterKeys').mockRejectedValue(
      new FirmApiError(403, 'walled', 'Access denied'),
    );

    const result = await obtainMatterKey(client, 'matter-walled');

    expect(result).toBeNull();
    // Keychain must still be empty for this matter
    const stored = await loadMatterKey('matter-walled');
    expect(stored).toBeNull();
  });

  it('404 → returns null', async () => {
    const client = mockClient();
    vi.spyOn(client, 'fetchMatterKeys').mockRejectedValue(
      new FirmApiError(404, 'not_found', 'No key published for this device'),
    );

    const result = await obtainMatterKey(client, 'matter-404');
    expect(result).toBeNull();
  });

  it('success path: unwraps and stores the matter key, then returns it', async () => {
    // Set up: "the server" has a wrapped key that was wrapped TO this device's public key
    const { publicJwk, deviceId } = await getOrCreateDeviceKeypair();

    const matterKeyB64 = await generateMatterKey();

    // Import wrapMatterKey to create the wrapped blob as the server would have stored it
    const { wrapMatterKey } = await import('@/modules/firm/keyWrap');
    const wrappedKeyB64 = await wrapMatterKey(matterKeyB64, publicJwk, 2);

    const client = mockClient();
    vi.spyOn(client, 'fetchMatterKeys').mockResolvedValue({
      epoch: 2,
      wrapped_key_b64: wrappedKeyB64,
    });

    const result = await obtainMatterKey(client, 'matter-success');

    expect(result).toBe(matterKeyB64);

    // Key must be stored in keychain now
    const stored = await loadMatterKey('matter-success');
    expect(stored).toBe(matterKeyB64);
  });

  it('non-403/404 errors propagate (do not swallow unexpected errors)', async () => {
    const client = mockClient();
    vi.spyOn(client, 'fetchMatterKeys').mockRejectedValue(
      new FirmApiError(500, 'server_error', 'Internal server error'),
    );

    await expect(obtainMatterKey(client, 'matter-500')).rejects.toBeInstanceOf(FirmApiError);

    // Nothing stored in keychain on unexpected error
    const stored = await loadMatterKey('matter-500');
    expect(stored).toBeNull();
  });
});
