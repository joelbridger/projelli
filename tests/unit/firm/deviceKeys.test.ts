/**
 * deviceKeys — unit tests for getOrCreateDeviceKeypair + registerDevice.
 *
 * The keychain is mocked via the same Tauri invoke/isTauri pattern used in
 * firmStore.test.ts. WebCrypto is the real jsdom SubtleCrypto (ECDH P-256
 * key generation is supported there).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock the OS keychain bridge (Tauri mode, backed by an in-memory Map).
const keychainStore = new Map<string, string>();
const invokeMock = vi.fn(async (cmd: string, args: Record<string, unknown> = {}) => {
  const svc = (args['service'] as string) ?? 'com.keepance.app';
  const key = args['key'] as string;
  const id = `${svc}::${key}`;
  if (cmd === 'keychain_set') {
    keychainStore.set(id, args['value'] as string);
    return undefined;
  }
  if (cmd === 'keychain_get') {
    if (!keychainStore.has(id)) throw { kind: 'notFound', message: 'no entry' };
    return keychainStore.get(id);
  }
  if (cmd === 'keychain_delete') {
    keychainStore.delete(id);
    return undefined;
  }
  throw new Error(`unexpected invoke ${cmd}`);
});
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...a: unknown[]) => invokeMock(...(a as [string, Record<string, unknown>])),
  isTauri: () => true,
}));

// ── Mock fetch for FirmApiClient (used by registerDevice).
const fetchMock = vi.fn();
vi.mock('@/platform/providers/fetchUtils', () => ({
  getCorsSafeFetch: async () => fetchMock as unknown as typeof fetch,
}));

import { getOrCreateDeviceKeypair, registerDevice, _resetDeviceCache } from '@/platform/firm/deviceKeys';
import { FirmApiClient, type TokenSource } from '@/platform/firm/FirmApiClient';

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

function tokenSource(): TokenSource {
  return {
    getAccessToken: () => 'TEST_ACCESS_TOKEN',
    refreshAccessToken: async () => 'TEST_ACCESS_TOKEN',
  };
}

describe('deviceKeys — getOrCreateDeviceKeypair', () => {
  beforeEach(() => {
    keychainStore.clear();
    fetchMock.mockReset();
    invokeMock.mockClear();
    _resetDeviceCache();
    // The global test harness (tests/setup.ts) seeds a 'lantern:settings'
    // entry into localStorage so cloud-send tests aren't blocked by the
    // fail-closed guard. Clear it here so the "no localStorage fallback"
    // security assertion below reads a true value — i.e. it proves the
    // device-key code itself wrote NOTHING to localStorage, not just that
    // the harness seed is absent.
    localStorage.clear();
  });

  it('generates a stable deviceId and valid ECDH P-256 public key', async () => {
    const { deviceId, publicJwk } = await getOrCreateDeviceKeypair();

    // deviceId must be a UUID-shaped string (non-empty, stable format)
    expect(typeof deviceId).toBe('string');
    expect(deviceId.length).toBeGreaterThan(10);

    // publicJwk must be a valid ECDH P-256 public key
    expect(publicJwk.kty).toBe('EC');
    expect(publicJwk.crv).toBe('P-256');
    expect(publicJwk.x).toBeTruthy();
    expect(publicJwk.y).toBeTruthy();
    // No private key material in the exported public JWK
    expect(publicJwk.d).toBeUndefined();
  });

  it('returns the SAME deviceId + publicJwk on a second call (idempotent)', async () => {
    const first = await getOrCreateDeviceKeypair();
    const second = await getOrCreateDeviceKeypair();

    expect(second.deviceId).toBe(first.deviceId);
    expect(JSON.stringify(second.publicJwk)).toBe(JSON.stringify(first.publicJwk));
  });

  it('persists in the keychain (no localStorage fallback in Tauri mode)', async () => {
    // Assert on what the device-key code ITSELF writes, not on the global
    // localStorage length. A bare `localStorage.length === 0` check is fragile:
    // it can be tripped by an unrelated async write leaking in from another
    // test during the await below, or by the global harness seed. Spying on
    // setItem and clearing it immediately before the call scopes the assertion
    // precisely to the security property we care about: the device-key code
    // must persist key material to the keychain, never to localStorage.
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem');
    setItemSpy.mockClear();

    await getOrCreateDeviceKeypair();

    // At least one keychain_set call should have occurred
    const setCalls = invokeMock.mock.calls.filter(([cmd]) => cmd === 'keychain_set');
    expect(setCalls.length).toBeGreaterThan(0);
    // The device-key code must not write anything to localStorage.
    expect(setItemSpy).not.toHaveBeenCalled();

    setItemSpy.mockRestore();
  });

  it('can ECDH-derive bits from the returned public key (proves it is a real EC key)', async () => {
    const { publicJwk } = await getOrCreateDeviceKeypair();

    // Import it as ECDH key — should not throw
    const imported = await crypto.subtle.importKey(
      'jwk',
      publicJwk,
      { name: 'ECDH', namedCurve: 'P-256' },
      false,
      [],
    );
    expect(imported.type).toBe('public');
  });
});

describe('deviceKeys — registerDevice', () => {
  beforeEach(() => {
    keychainStore.clear();
    fetchMock.mockReset();
    invokeMock.mockClear();
    _resetDeviceCache();
  });

  it('POSTs to /device/register with device_id and pubkey_jwk', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { ok: true }));
    const client = new FirmApiClient(tokenSource());

    await registerDevice(client);

    const calls = fetchMock.mock.calls;
    expect(calls.length).toBe(1);
    const [url, init] = calls[0] as [string, RequestInit & { body: string }];
    expect(url).toContain('/device/register');
    const body = JSON.parse(init.body) as Record<string, unknown>;
    expect(body['device_id']).toBeTruthy();
    expect(body['pubkey_jwk']).toBeTruthy();
    expect((body['pubkey_jwk'] as { kty: string }).kty).toBe('EC');
  });

  it('is idempotent — two calls issue two POSTs but use the same keypair', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { ok: true }));
    const client = new FirmApiClient(tokenSource());

    await registerDevice(client);
    await registerDevice(client);

    const calls = fetchMock.mock.calls;
    expect(calls.length).toBe(2);

    const body1 = JSON.parse((calls[0] as [string, RequestInit & { body: string }])[1].body) as Record<string, unknown>;
    const body2 = JSON.parse((calls[1] as [string, RequestInit & { body: string }])[1].body) as Record<string, unknown>;

    // Same device_id on both calls
    expect(body1['device_id']).toBe(body2['device_id']);
    // Same pubkey_jwk on both calls (only one keypair ever generated)
    expect(JSON.stringify(body1['pubkey_jwk'])).toBe(JSON.stringify(body2['pubkey_jwk']));
  });
});
