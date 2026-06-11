/**
 * matterKeyDistribution — integration tests for publishMatterKeyToMembers,
 * obtainMatterKey, and the VG-6a auto-republish poll helpers
 * (deviceSetFingerprint + autoRepublishHeldMatterKeys), all against a mocked
 * FirmApiClient.
 *
 * Adversarial cases:
 *   - 403 → null and keychain untouched
 *   - 404 → null
 *   - walled member's device never appears in publish payload
 *   - escrow: every org admin's devices appear in publish payload even if
 *     they are not matter members
 *   - success path stores the unwrapped key in the keychain
 *   - epoch rotation: publishMatterKeyToMembers uses the CURRENT epoch
 *   - WALL invariant under auto-republish: a walled member's new device never
 *     triggers drift and never receives a wrapped key, even if the relay
 *     injects the walled user's devices into the device-listing response
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
import {
  publishMatterKeyToMembers,
  obtainMatterKey,
  deviceSetFingerprint,
  autoRepublishHeldMatterKeys,
} from '@/modules/firm/matterKeyService';
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

// ── VG-6a — device-set fingerprint + auto-republish poll ────────────────────

describe('deviceSetFingerprint', () => {
  it('is order-independent over the device set', () => {
    const a = deviceSetFingerprint(
      [
        { user_id: 'alice', device_id: 'd1' },
        { user_id: 'bob', device_id: 'd2' },
      ],
      1,
    );
    const b = deviceSetFingerprint(
      [
        { user_id: 'bob', device_id: 'd2' },
        { user_id: 'alice', device_id: 'd1' },
      ],
      1,
    );
    expect(a).toBe(b);
  });

  it('changes when the epoch changes', () => {
    const devices = [{ user_id: 'alice', device_id: 'd1' }];
    expect(deviceSetFingerprint(devices, 1)).not.toBe(deviceSetFingerprint(devices, 2));
  });

  it('changes when a device is added', () => {
    const before = deviceSetFingerprint([{ user_id: 'alice', device_id: 'd1' }], 1);
    const after = deviceSetFingerprint(
      [
        { user_id: 'alice', device_id: 'd1' },
        { user_id: 'alice', device_id: 'd2' },
      ],
      1,
    );
    expect(before).not.toBe(after);
  });
});

describe('autoRepublishHeldMatterKeys', () => {
  beforeEach(() => {
    keychainStore.clear();
    fetchMock.mockReset();
    invokeMock.mockClear();
    _resetDeviceCache();
  });

  it('republishes exactly once when a matter device set grew, and records the new fingerprint', async () => {
    const matterKeyB64 = await generateMatterKey();
    await storeMatterKey('matter-grow', matterKeyB64);
    const alice = await generateMemberKeyPair();

    const client = mockClient();
    vi.spyOn(client, 'listMatterMembers').mockResolvedValue({
      matter_id: 'matter-grow',
      key_epoch: 1,
      members: [
        { matter_id: 'matter-grow', user_id: 'alice', org_id: 'org-1', role: 'editor', created_at: '' },
      ],
      walls: [],
    });
    vi.spyOn(client, 'listOrgAdmins').mockResolvedValue({ admins: [] });
    // Alice now has TWO devices; the recorded fingerprint only knew the first.
    vi.spyOn(client, 'fetchOrgUserDevices').mockResolvedValue({
      devices: [
        { user_id: 'alice', device_id: 'alice-d1', pubkey_jwk: alice.publicJwk, label: 'laptop' },
        { user_id: 'alice', device_id: 'alice-d2', pubkey_jwk: alice.publicJwk, label: 'new desktop' },
      ],
    });
    const publishSpy = vi
      .spyOn(client, 'publishMatterKeys')
      .mockImplementation(async (_matterId, payload) => ({ ok: true, stored: payload.wrapped.length }));

    const before = deviceSetFingerprint([{ user_id: 'alice', device_id: 'alice-d1' }], 1);
    const res = await autoRepublishHeldMatterKeys(
      client,
      [{ matter_id: 'matter-grow', key_epoch: 1 }],
      { 'matter-grow': before },
    );

    expect(publishSpy).toHaveBeenCalledTimes(1);
    expect(res.republishedMatterIds).toEqual(['matter-grow']);
    expect(res.fingerprints['matter-grow']).toBe(
      deviceSetFingerprint(
        [
          { user_id: 'alice', device_id: 'alice-d1' },
          { user_id: 'alice', device_id: 'alice-d2' },
        ],
        1,
      ),
    );
  });

  it('publishes nothing when the device set is unchanged', async () => {
    const matterKeyB64 = await generateMatterKey();
    await storeMatterKey('matter-same', matterKeyB64);
    const alice = await generateMemberKeyPair();

    const client = mockClient();
    vi.spyOn(client, 'listMatterMembers').mockResolvedValue({
      matter_id: 'matter-same',
      key_epoch: 1,
      members: [
        { matter_id: 'matter-same', user_id: 'alice', org_id: 'org-1', role: 'editor', created_at: '' },
      ],
      walls: [],
    });
    vi.spyOn(client, 'listOrgAdmins').mockResolvedValue({ admins: [] });
    vi.spyOn(client, 'fetchOrgUserDevices').mockResolvedValue({
      devices: [
        { user_id: 'alice', device_id: 'alice-d1', pubkey_jwk: alice.publicJwk, label: 'laptop' },
      ],
    });
    const publishSpy = vi.spyOn(client, 'publishMatterKeys');

    const current = deviceSetFingerprint([{ user_id: 'alice', device_id: 'alice-d1' }], 1);
    const res = await autoRepublishHeldMatterKeys(
      client,
      [{ matter_id: 'matter-same', key_epoch: 1 }],
      { 'matter-same': current },
    );

    expect(publishSpy).not.toHaveBeenCalled();
    expect(res.republishedMatterIds).toEqual([]);
    expect(res.fingerprints['matter-same']).toBe(current);
  });

  it('skips a matter with no local key without touching the network at all', async () => {
    const client = mockClient();
    const membersSpy = vi.spyOn(client, 'listMatterMembers');
    const adminsSpy = vi.spyOn(client, 'listOrgAdmins');
    const devicesSpy = vi.spyOn(client, 'fetchOrgUserDevices');
    const publishSpy = vi.spyOn(client, 'publishMatterKeys');

    const res = await autoRepublishHeldMatterKeys(
      client,
      [{ matter_id: 'matter-not-held', key_epoch: 3 }],
      {},
    );

    // Key-first ordering: not the holder → no network call of any kind.
    expect(membersSpy).not.toHaveBeenCalled();
    expect(adminsSpy).not.toHaveBeenCalled();
    expect(devicesSpy).not.toHaveBeenCalled();
    expect(publishSpy).not.toHaveBeenCalled();
    expect(res.republishedMatterIds).toEqual([]);
    expect(res.fingerprints).toEqual({});
  });

  it('one matter publish failure does not abort the others, and the failed fingerprint is not recorded', async () => {
    await storeMatterKey('matter-bad', await generateMatterKey());
    await storeMatterKey('matter-good', await generateMatterKey());
    const alice = await generateMemberKeyPair();

    const client = mockClient();
    vi.spyOn(client, 'listMatterMembers').mockImplementation(async (matterId: string) => ({
      matter_id: matterId,
      key_epoch: 1,
      members: [
        { matter_id: matterId, user_id: 'alice', org_id: 'org-1', role: 'editor', created_at: '' },
      ],
      walls: [],
    }));
    vi.spyOn(client, 'listOrgAdmins').mockResolvedValue({ admins: [] });
    vi.spyOn(client, 'fetchOrgUserDevices').mockResolvedValue({
      devices: [
        { user_id: 'alice', device_id: 'alice-d1', pubkey_jwk: alice.publicJwk, label: 'laptop' },
      ],
    });
    const publishSpy = vi
      .spyOn(client, 'publishMatterKeys')
      .mockImplementation(async (matterId, payload) => {
        if (matterId === 'matter-bad') throw new FirmApiError(500, 'server_error', 'boom');
        return { ok: true, stored: payload.wrapped.length };
      });

    const res = await autoRepublishHeldMatterKeys(
      client,
      [
        { matter_id: 'matter-bad', key_epoch: 1 },
        { matter_id: 'matter-good', key_epoch: 1 },
      ],
      {},
    );

    // Both matters were ATTEMPTED (the failure did not abort the loop) ...
    expect(publishSpy).toHaveBeenCalledTimes(2);
    // ... but only the successful one is reported and fingerprinted.
    expect(res.republishedMatterIds).toEqual(['matter-good']);
    expect(res.fingerprints['matter-good']).toBeDefined();
    // No fingerprint for the failed matter → the next poll retries it.
    expect(res.fingerprints['matter-bad']).toBeUndefined();
  });

  it('WALL: a walled member registering a new device causes no drift and no publish', async () => {
    await storeMatterKey('matter-wall', await generateMatterKey());
    const alice = await generateMemberKeyPair();
    const mallory = await generateMemberKeyPair();

    const client = mockClient();
    vi.spyOn(client, 'listMatterMembers').mockResolvedValue({
      matter_id: 'matter-wall',
      key_epoch: 1,
      members: [
        { matter_id: 'matter-wall', user_id: 'alice', org_id: 'org-1', role: 'editor', created_at: '' },
        { matter_id: 'matter-wall', user_id: 'mallory', org_id: 'org-1', role: 'editor', created_at: '' },
      ],
      walls: [
        { matter_id: 'matter-wall', user_id: 'mallory', org_id: 'org-1', reason: 'conflict', created_by: 'admin', created_at: '' },
      ],
    });
    vi.spyOn(client, 'listOrgAdmins').mockResolvedValue({ admins: [] });
    // ADVERSARIAL relay: returns the walled user's devices (including a brand
    // new one) even though a correct server is only asked for non-walled users.
    const devicesSpy = vi.spyOn(client, 'fetchOrgUserDevices').mockResolvedValue({
      devices: [
        { user_id: 'alice', device_id: 'alice-d1', pubkey_jwk: alice.publicJwk, label: 'laptop' },
        { user_id: 'mallory', device_id: 'mallory-d1', pubkey_jwk: mallory.publicJwk, label: 'old' },
        { user_id: 'mallory', device_id: 'mallory-d2', pubkey_jwk: mallory.publicJwk, label: 'NEW device' },
      ],
    });
    const publishSpy = vi.spyOn(client, 'publishMatterKeys');

    // Recorded fingerprint reflects the eligible set before mallory's new
    // device existed: just alice-d1. Walled devices were never part of it.
    const before = deviceSetFingerprint([{ user_id: 'alice', device_id: 'alice-d1' }], 1);
    const res = await autoRepublishHeldMatterKeys(
      client,
      [{ matter_id: 'matter-wall', key_epoch: 1 }],
      { 'matter-wall': before },
    );

    // Walled devices are invisible to drift detection: no republish at all.
    expect(publishSpy).not.toHaveBeenCalled();
    expect(res.republishedMatterIds).toEqual([]);
    expect(res.fingerprints['matter-wall']).toBe(before);
    // And the device listing never asked the server for the walled user.
    expect(devicesSpy).toHaveBeenCalledWith(expect.not.arrayContaining(['mallory']));
  });

  it('WALL: a drift republish never wraps keys to a walled member device, even when the relay injects them', async () => {
    const matterKeyB64 = await generateMatterKey();
    await storeMatterKey('matter-wall-grow', matterKeyB64);
    const alice = await generateMemberKeyPair();
    const mallory = await generateMemberKeyPair();

    const client = mockClient();
    vi.spyOn(client, 'listMatterMembers').mockResolvedValue({
      matter_id: 'matter-wall-grow',
      key_epoch: 2,
      members: [
        { matter_id: 'matter-wall-grow', user_id: 'alice', org_id: 'org-1', role: 'editor', created_at: '' },
        { matter_id: 'matter-wall-grow', user_id: 'mallory', org_id: 'org-1', role: 'editor', created_at: '' },
      ],
      walls: [
        { matter_id: 'matter-wall-grow', user_id: 'mallory', org_id: 'org-1', reason: 'conflict', created_by: 'admin', created_at: '' },
      ],
    });
    vi.spyOn(client, 'listOrgAdmins').mockResolvedValue({ admins: [] });
    // Drift: alice registered a second device. The misbehaving relay ALSO
    // injects walled mallory's devices into the listing response.
    vi.spyOn(client, 'fetchOrgUserDevices').mockResolvedValue({
      devices: [
        { user_id: 'alice', device_id: 'alice-d1', pubkey_jwk: alice.publicJwk, label: 'laptop' },
        { user_id: 'alice', device_id: 'alice-d2', pubkey_jwk: alice.publicJwk, label: 'new desktop' },
        { user_id: 'mallory', device_id: 'mallory-d1', pubkey_jwk: mallory.publicJwk, label: 'old' },
        { user_id: 'mallory', device_id: 'mallory-d2', pubkey_jwk: mallory.publicJwk, label: 'NEW device' },
      ],
    });
    let publishPayload: { epoch: number; wrapped: Array<{ user_id: string; device_id: string }> } | null = null;
    const publishSpy = vi
      .spyOn(client, 'publishMatterKeys')
      .mockImplementation(async (_matterId, payload) => {
        publishPayload = payload;
        return { ok: true, stored: payload.wrapped.length };
      });

    const before = deviceSetFingerprint([{ user_id: 'alice', device_id: 'alice-d1' }], 2);
    const res = await autoRepublishHeldMatterKeys(
      client,
      [{ matter_id: 'matter-wall-grow', key_epoch: 2 }],
      { 'matter-wall-grow': before },
    );

    // Drift from alice's new device → exactly one publish ...
    expect(publishSpy).toHaveBeenCalledTimes(1);
    expect(res.republishedMatterIds).toEqual(['matter-wall-grow']);
    // ... whose payload contains alice's devices ONLY. Walled mallory gets
    // NOTHING, not even for her pre-existing device.
    expect(publishPayload).not.toBeNull();
    const wrappedDeviceIds = publishPayload!.wrapped.map((w) => w.device_id).sort();
    expect(wrappedDeviceIds).toEqual(['alice-d1', 'alice-d2']);
    expect(publishPayload!.wrapped.map((w) => w.user_id)).not.toContain('mallory');
    // The recorded fingerprint covers ELIGIBLE devices only, so injected
    // walled devices cannot poison drift detection into republish churn.
    expect(res.fingerprints['matter-wall-grow']).toBe(
      deviceSetFingerprint(
        [
          { user_id: 'alice', device_id: 'alice-d1' },
          { user_id: 'alice', device_id: 'alice-d2' },
        ],
        2,
      ),
    );
  });
});
