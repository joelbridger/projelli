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
  const svc = (args['service'] as string) ?? 'com.keepance.app';
  const key = args['key'] as string;
  const id = `${svc}::${key}`;
  if (cmd === 'keychain_set') { keychainStore.set(id, args['value'] as string); return undefined; }
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
vi.mock('@/platform/providers/fetchUtils', () => ({
  getCorsSafeFetch: async () => fetchMock as unknown as typeof fetch,
}));

import { FirmApiClient, FirmApiError } from '@/platform/firm/FirmApiClient';
import {
  publishMatterKeyToMembers,
  obtainMatterKey,
  deviceSetFingerprint,
  autoRepublishHeldMatterKeys,
} from '@/platform/firm/matterKeyService';
import { storeMatterKey, loadMatterKey } from '@/platform/firm/firmKeychain';
import { getOrCreateDeviceKeypair, _resetDeviceCache } from '@/platform/firm/deviceKeys';
import { generateMatterKey } from '@/platform/firm/matterCrypto';
import type { MatterHandle } from '@/platform/firm/contract';

const handle = (label: string) => `mh2_${label.padEnd(43, 'x').slice(0, 43)}` as MatterHandle;

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
    const matterHandle = handle('matter-1');
    await storeMatterKey(matterHandle, matterKeyB64);

    // Ensure this device has a keypair
    await getOrCreateDeviceKeypair();

    // Two "member" devices: alice (not walled) and bob (walled)
    const alice = await generateMemberKeyPair();
    const bob = await generateMemberKeyPair();

    const client = mockClient();

    // Stub listMatterMembers: alice is a member, bob is both a member AND walled
    vi.spyOn(client, 'listMatterMembers').mockResolvedValue({
      key_epoch: 1,
      members: [
        { user_id: 'alice', org_id: 'org-1', role: 'editor', created_at: '' },
        { user_id: 'bob', org_id: 'org-1', role: 'editor', created_at: '' },
      ],
      walls: [
        { user_id: 'bob', org_id: 'org-1', created_by: 'admin', created_at: '' },
      ],
    });

    // Stub fetchOrgUserDevices: return devices for alice + bob
    vi.spyOn(client, 'fetchOrgUserDevices').mockResolvedValue({
      devices: [
        { user_id: 'alice', device_id: 'alice-device-1', pubkey_jwk: alice.publicJwk },
        { user_id: 'bob', device_id: 'bob-device-1', pubkey_jwk: bob.publicJwk },
      ],
    });

    // No admin escrow in this test variant
    vi.spyOn(client, 'listOrgAdmins').mockResolvedValue({ admins: [] });

    let publishPayload: { epoch: number; wrapped: Array<{ user_id: string; device_id: string; wrapped_key_b64: string }> } | null = null;
    vi.spyOn(client, 'publishMatterKeys').mockImplementation(async (_matterId, payload) => {
      publishPayload = payload;
      return { ok: true, stored: payload.wrapped.length };
    });

    const result = await publishMatterKeyToMembers(client, matterHandle, 1);

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
    const matterHandle = handle('matter-escrow');
    await storeMatterKey(matterHandle, matterKeyB64);

    const member = await generateMemberKeyPair();
    const admin = await generateMemberKeyPair();

    const client = mockClient();

    vi.spyOn(client, 'listMatterMembers').mockResolvedValue({
      key_epoch: 1,
      members: [
        { user_id: 'member-user', org_id: 'org-1', role: 'editor', created_at: '' },
        // admin-user is NOT listed as a member — should still be included via escrow
      ],
      walls: [],
    });

    vi.spyOn(client, 'fetchOrgUserDevices').mockImplementation(async (userIds: string[]) => {
      const allDevices: Array<{ user_id: string; device_id: string; pubkey_jwk: JsonWebKey }> = [];
      if (userIds.includes('member-user')) {
        allDevices.push({ user_id: 'member-user', device_id: 'member-d1', pubkey_jwk: member.publicJwk });
      }
      if (userIds.includes('admin-user')) {
        allDevices.push({ user_id: 'admin-user', device_id: 'admin-d1', pubkey_jwk: admin.publicJwk });
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

    await publishMatterKeyToMembers(client, matterHandle, 1);

    const wrappedFor = publishPayload!.wrapped.map((w) => w.user_id);
    expect(wrappedFor).toContain('member-user');
    // Admin gets escrow copy even though not a matter member
    expect(wrappedFor).toContain('admin-user');
  });

  it('throws if no local matter key exists (caller must be the holder)', async () => {
    const client = mockClient();
    // No matter key stored for this matter — publishMatterKeyToMembers should
    // throw before making any network calls.
    await expect(publishMatterKeyToMembers(client, handle('matter-missing'), 1)).rejects.toThrow(
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
    const matterHandle = handle('matter-local');
    await storeMatterKey(matterHandle, matterKeyB64);

    const client = mockClient();
    const fetchKeysSpy = vi.spyOn(client, 'fetchMatterKeys');

    const result = await obtainMatterKey(client, matterHandle, 'seat-token');

    expect(result).toBe(matterKeyB64);
    // Should NOT have made a network call
    expect(fetchKeysSpy).not.toHaveBeenCalled();
  });

  it('403 → returns null and does NOT store anything in the keychain', async () => {
    const client = mockClient();
    vi.spyOn(client, 'fetchMatterKeys').mockRejectedValue(
      new FirmApiError(403, 'walled', 'Access denied'),
    );

    const matterHandle = handle('matter-walled');
    const result = await obtainMatterKey(client, matterHandle, 'seat-token');

    expect(result).toBeNull();
    // Keychain must still be empty for this matter
    const stored = await loadMatterKey(matterHandle);
    expect(stored).toBeNull();
  });

  it('404 → returns null', async () => {
    const client = mockClient();
    vi.spyOn(client, 'fetchMatterKeys').mockRejectedValue(
      new FirmApiError(404, 'not_found', 'No key published for this device'),
    );

    const result = await obtainMatterKey(client, handle('matter-404'), 'seat-token');
    expect(result).toBeNull();
  });

  it('success path: unwraps and stores the matter key, then returns it', async () => {
    // Set up: "the server" has a wrapped key that was wrapped TO this device's public key
    const { publicJwk } = await getOrCreateDeviceKeypair();

    const matterKeyB64 = await generateMatterKey();

    // Import wrapMatterKey to create the wrapped blob as the server would have stored it
    const { wrapMatterKey } = await import('@/platform/firm/keyWrap');
    const wrappedKeyB64 = await wrapMatterKey(matterKeyB64, publicJwk, 2);

    const client = mockClient();
    vi.spyOn(client, 'fetchMatterKeys').mockResolvedValue({
      epoch: 2,
      wrapped_key_b64: wrappedKeyB64,
    });

    const matterHandle = handle('matter-success');
    const result = await obtainMatterKey(client, matterHandle, 'seat-token');

    expect(result).toBe(matterKeyB64);

    // Key must be stored in keychain now
    const stored = await loadMatterKey(matterHandle);
    expect(stored).toBe(matterKeyB64);
  });

  it('non-403/404 errors propagate (do not swallow unexpected errors)', async () => {
    const client = mockClient();
    vi.spyOn(client, 'fetchMatterKeys').mockRejectedValue(
      new FirmApiError(500, 'server_error', 'Internal server error'),
    );

    const matterHandle = handle('matter-500');
    await expect(obtainMatterKey(client, matterHandle, 'seat-token')).rejects.toBeInstanceOf(FirmApiError);

    // Nothing stored in keychain on unexpected error
    const stored = await loadMatterKey(matterHandle);
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
    const matterHandle = handle('matter-grow');
    const matterKeyB64 = await generateMatterKey();
    await storeMatterKey(matterHandle, matterKeyB64);
    const alice = await generateMemberKeyPair();

    const client = mockClient();
    vi.spyOn(client, 'listMatterMembers').mockResolvedValue({
      key_epoch: 1,
      members: [
        { user_id: 'alice', org_id: 'org-1', role: 'editor', created_at: '' },
      ],
      walls: [],
    });
    vi.spyOn(client, 'listOrgAdmins').mockResolvedValue({ admins: [] });
    // Alice now has TWO devices; the recorded fingerprint only knew the first.
    vi.spyOn(client, 'fetchOrgUserDevices').mockResolvedValue({
      devices: [
        { user_id: 'alice', device_id: 'alice-d1', pubkey_jwk: alice.publicJwk },
        { user_id: 'alice', device_id: 'alice-d2', pubkey_jwk: alice.publicJwk },
      ],
    });
    const publishSpy = vi
      .spyOn(client, 'publishMatterKeys')
      .mockImplementation(async (_matterId, payload) => ({ ok: true, stored: payload.wrapped.length }));

    const before = deviceSetFingerprint([{ user_id: 'alice', device_id: 'alice-d1' }], 1);
    const res = await autoRepublishHeldMatterKeys(
      client,
      [{ matter_handle: matterHandle, key_epoch: 1 }],
      { [matterHandle]: before },
    );

    expect(publishSpy).toHaveBeenCalledTimes(1);
    expect(res.republishedMatterIds).toEqual([matterHandle]);
    expect(res.fingerprints[matterHandle]).toBe(
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
    const matterHandle = handle('matter-same');
    const matterKeyB64 = await generateMatterKey();
    await storeMatterKey(matterHandle, matterKeyB64);
    const alice = await generateMemberKeyPair();

    const client = mockClient();
    vi.spyOn(client, 'listMatterMembers').mockResolvedValue({
      key_epoch: 1,
      members: [
        { user_id: 'alice', org_id: 'org-1', role: 'editor', created_at: '' },
      ],
      walls: [],
    });
    vi.spyOn(client, 'listOrgAdmins').mockResolvedValue({ admins: [] });
    vi.spyOn(client, 'fetchOrgUserDevices').mockResolvedValue({
      devices: [
        { user_id: 'alice', device_id: 'alice-d1', pubkey_jwk: alice.publicJwk },
      ],
    });
    const publishSpy = vi.spyOn(client, 'publishMatterKeys');

    const current = deviceSetFingerprint([{ user_id: 'alice', device_id: 'alice-d1' }], 1);
    const res = await autoRepublishHeldMatterKeys(
      client,
      [{ matter_handle: matterHandle, key_epoch: 1 }],
      { [matterHandle]: current },
    );

    expect(publishSpy).not.toHaveBeenCalled();
    expect(res.republishedMatterIds).toEqual([]);
    expect(res.fingerprints[matterHandle]).toBe(current);
  });

  it('skips a matter with no local key without touching the network at all', async () => {
    const matterHandle = handle('matter-not-held');
    const client = mockClient();
    const membersSpy = vi.spyOn(client, 'listMatterMembers');
    const adminsSpy = vi.spyOn(client, 'listOrgAdmins');
    const devicesSpy = vi.spyOn(client, 'fetchOrgUserDevices');
    const publishSpy = vi.spyOn(client, 'publishMatterKeys');

    const res = await autoRepublishHeldMatterKeys(
      client,
      [{ matter_handle: matterHandle, key_epoch: 3 }],
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
    const badHandle = handle('matter-bad');
    const goodHandle = handle('matter-good');
    await storeMatterKey(badHandle, await generateMatterKey());
    await storeMatterKey(goodHandle, await generateMatterKey());
    const alice = await generateMemberKeyPair();

    const client = mockClient();
    vi.spyOn(client, 'listMatterMembers').mockImplementation(async () => ({
      key_epoch: 1,
      members: [
        { user_id: 'alice', org_id: 'org-1', role: 'editor', created_at: '' },
      ],
      walls: [],
    }));
    vi.spyOn(client, 'listOrgAdmins').mockResolvedValue({ admins: [] });
    vi.spyOn(client, 'fetchOrgUserDevices').mockResolvedValue({
      devices: [
        { user_id: 'alice', device_id: 'alice-d1', pubkey_jwk: alice.publicJwk },
      ],
    });
    const publishSpy = vi
      .spyOn(client, 'publishMatterKeys')
      .mockImplementation(async (matterId, payload) => {
        if (matterId === badHandle) throw new FirmApiError(500, 'server_error', 'boom');
        return { ok: true, stored: payload.wrapped.length };
      });

    const res = await autoRepublishHeldMatterKeys(
      client,
      [
        { matter_handle: badHandle, key_epoch: 1 },
        { matter_handle: goodHandle, key_epoch: 1 },
      ],
      {},
    );

    // Both matters were ATTEMPTED (the failure did not abort the loop) ...
    expect(publishSpy).toHaveBeenCalledTimes(2);
    // ... but only the successful one is reported and fingerprinted.
    expect(res.republishedMatterIds).toEqual([goodHandle]);
    expect(res.fingerprints[goodHandle]).toBeDefined();
    // No fingerprint for the failed matter → the next poll retries it.
    expect(res.fingerprints[badHandle]).toBeUndefined();
  });

  it('WALL: a walled member registering a new device causes no drift and no publish', async () => {
    const matterHandle = handle('matter-wall');
    await storeMatterKey(matterHandle, await generateMatterKey());
    const alice = await generateMemberKeyPair();
    const mallory = await generateMemberKeyPair();

    const client = mockClient();
    vi.spyOn(client, 'listMatterMembers').mockResolvedValue({
      key_epoch: 1,
      members: [
        { user_id: 'alice', org_id: 'org-1', role: 'editor', created_at: '' },
        { user_id: 'mallory', org_id: 'org-1', role: 'editor', created_at: '' },
      ],
      walls: [
        { user_id: 'mallory', org_id: 'org-1', created_by: 'admin', created_at: '' },
      ],
    });
    vi.spyOn(client, 'listOrgAdmins').mockResolvedValue({ admins: [] });
    // ADVERSARIAL relay: returns the walled user's devices (including a brand
    // new one) even though a correct server is only asked for non-walled users.
    const devicesSpy = vi.spyOn(client, 'fetchOrgUserDevices').mockResolvedValue({
      devices: [
        { user_id: 'alice', device_id: 'alice-d1', pubkey_jwk: alice.publicJwk },
        { user_id: 'mallory', device_id: 'mallory-d1', pubkey_jwk: mallory.publicJwk },
        { user_id: 'mallory', device_id: 'mallory-d2', pubkey_jwk: mallory.publicJwk },
      ],
    });
    const publishSpy = vi.spyOn(client, 'publishMatterKeys');

    // Recorded fingerprint reflects the eligible set before mallory's new
    // device existed: just alice-d1. Walled devices were never part of it.
    const before = deviceSetFingerprint([{ user_id: 'alice', device_id: 'alice-d1' }], 1);
    const res = await autoRepublishHeldMatterKeys(
      client,
      [{ matter_handle: matterHandle, key_epoch: 1 }],
      { [matterHandle]: before },
    );

    // Walled devices are invisible to drift detection: no republish at all.
    expect(publishSpy).not.toHaveBeenCalled();
    expect(res.republishedMatterIds).toEqual([]);
    expect(res.fingerprints[matterHandle]).toBe(before);
    // And the device listing never asked the server for the walled user.
    // Arity-proof: the client now threads an AbortSignal, so assert on the ARGUMENT
    // rather than the whole call shape. The invariant is what matters — a walled
    // member's user id must never even be QUERIED for devices.
    expect(devicesSpy.mock.calls[0]?.[0]).not.toContain('mallory');
  });

  it('WALL: a drift republish never wraps keys to a walled member device, even when the relay injects them', async () => {
    const matterHandle = handle('matter-wall-grow');
    const matterKeyB64 = await generateMatterKey();
    await storeMatterKey(matterHandle, matterKeyB64);
    const alice = await generateMemberKeyPair();
    const mallory = await generateMemberKeyPair();

    const client = mockClient();
    vi.spyOn(client, 'listMatterMembers').mockResolvedValue({
      key_epoch: 2,
      members: [
        { user_id: 'alice', org_id: 'org-1', role: 'editor', created_at: '' },
        { user_id: 'mallory', org_id: 'org-1', role: 'editor', created_at: '' },
      ],
      walls: [
        { user_id: 'mallory', org_id: 'org-1', created_by: 'admin', created_at: '' },
      ],
    });
    vi.spyOn(client, 'listOrgAdmins').mockResolvedValue({ admins: [] });
    // Drift: alice registered a second device. The misbehaving relay ALSO
    // injects walled mallory's devices into the listing response.
    vi.spyOn(client, 'fetchOrgUserDevices').mockResolvedValue({
      devices: [
        { user_id: 'alice', device_id: 'alice-d1', pubkey_jwk: alice.publicJwk },
        { user_id: 'alice', device_id: 'alice-d2', pubkey_jwk: alice.publicJwk },
        { user_id: 'mallory', device_id: 'mallory-d1', pubkey_jwk: mallory.publicJwk },
        { user_id: 'mallory', device_id: 'mallory-d2', pubkey_jwk: mallory.publicJwk },
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
      [{ matter_handle: matterHandle, key_epoch: 2 }],
      { [matterHandle]: before },
    );

    // Drift from alice's new device → exactly one publish ...
    expect(publishSpy).toHaveBeenCalledTimes(1);
    expect(res.republishedMatterIds).toEqual([matterHandle]);
    // ... whose payload contains alice's devices ONLY. Walled mallory gets
    // NOTHING, not even for her pre-existing device.
    expect(publishPayload).not.toBeNull();
    const wrappedDeviceIds = publishPayload!.wrapped.map((w) => w.device_id).sort();
    expect(wrappedDeviceIds).toEqual(['alice-d1', 'alice-d2']);
    expect(publishPayload!.wrapped.map((w) => w.user_id)).not.toContain('mallory');
    // The recorded fingerprint covers ELIGIBLE devices only, so injected
    // walled devices cannot poison drift detection into republish churn.
    expect(res.fingerprints[matterHandle]).toBe(
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
