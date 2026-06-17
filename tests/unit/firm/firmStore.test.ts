/**
 * firmStore — sign-in + activation wiring, with the backend HTTP and the OS
 * keychain mocked.
 *
 * Asserted:
 *   - sign-in stores the access + refresh tokens in the OS KEYCHAIN
 *     (com.keepance.user.<id>) and NOT in localStorage;
 *   - seat activation stores the seat token in the keychain and verifies it
 *     OFFLINE against the fetched seat public key;
 *   - an active seat yields the Firm entitlement (AI on);
 *   - admin actions (create matter / add member / set wall / set managed key)
 *     POST to the right endpoints with the right bodies.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateKeyPairSync, sign as edSign, type KeyObject } from 'node:crypto';

// ── Mock the OS keychain bridge: isTauri() === true, invoke() backed by a Map.
const keychainStore = new Map<string, string>();
const invokeMock = vi.fn(async (cmd: string, args: Record<string, unknown> = {}) => {
  const svc = (args.service as string) ?? 'com.keepance.app';
  const key = args.key as string;
  const id = `${svc}::${key}`;
  if (cmd === 'keychain_set') {
    keychainStore.set(id, args.value as string);
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

// ── Mock the CORS-safe fetch the FirmApiClient uses. Driven per-test.
const fetchMock = vi.fn();
vi.mock('@/platform/providers/fetchUtils', () => ({
  getCorsSafeFetch: async () => fetchMock as unknown as typeof fetch,
}));

import { useFirmStore, selectFirmEntitlement } from '@/platform/firm/firmStore';

// ── Mint a real EdDSA seat token (the wire format the client verifies offline).
function b64url(buf: Buffer | Uint8Array): string {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function mintSeatToken(payload: Record<string, unknown>, privateKey: KeyObject): string {
  const header = b64url(Buffer.from(JSON.stringify({ alg: 'EdDSA', typ: 'JWT' })));
  const body = b64url(Buffer.from(JSON.stringify(payload)));
  const input = `${header}.${body}`;
  return `${input}.${b64url(edSign(null, Buffer.from(input), privateKey))}`;
}

const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const PUBLIC_PEM = publicKey.export({ type: 'spki', format: 'pem' }).toString();

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}
function textResponse(status: number, body: string): Response {
  return { ok: status >= 200 && status < 300, status, text: async () => body } as unknown as Response;
}

const LOGIN_BODY = {
  user: { user_id: 'user-1', email: 'lawyer@firm.com', role: 'admin', status: 'active', created_at: 'now' },
  access_token: 'ACCESS_JWT',
  access_expires_at: 'later',
  refresh_token: 'REFRESH_TOKEN',
  refresh_expires_at: 'later',
};

function seatTokenFor(exp: number): string {
  return mintSeatToken(
    {
      org_id: 'org-1',
      user_id: 'user-1',
      seat_id: 'seat-1',
      machine_id: 'm',
      tier: 'practice',
      packs: ['legal'],
      seats: 5,
      iat: Math.floor(Date.now() / 1000) - 10,
      exp,
    },
    privateKey,
  );
}

/** Route a request by URL+method to the right canned response. */
function routeFetch(handlers: Array<{ match: RegExp; method?: string; res: () => Response }>) {
  fetchMock.mockImplementation(async (url: string, init?: { method?: string }) => {
    const method = init?.method ?? 'GET';
    for (const h of handlers) {
      if (h.match.test(url) && (!h.method || h.method === method)) return h.res();
    }
    throw new Error(`unmocked fetch: ${method} ${url}`);
  });
}

beforeEach(() => {
  keychainStore.clear();
  invokeMock.mockClear();
  fetchMock.mockReset();
  // Reset the store between tests.
  useFirmStore.setState({
    session: null,
    accessToken: null,
    seatToken: null,
    seatPublicKeyPem: null,
    serverVerdict: 'unknown',
    offlineSeatValid: false,
    isOffline: false,
    isLoading: false,
    error: null,
    assuredProviders: [],
  });
});

describe('firmStore sign-in', () => {
  it('stores access + refresh tokens in the OS KEYCHAIN, not localStorage', async () => {
    routeFetch([
      { match: /\/auth\/login$/, method: 'POST', res: () => jsonResponse(200, LOGIN_BODY) },
      { match: /\/auth\/me$/, res: () => jsonResponse(200, { user: LOGIN_BODY.user, org: { org_id: 'org-1', name: 'Firm LLP', plan: 'practice', packs: ['legal'], seat_limit: 5 } }) },
      { match: /seat-pubkey$/, res: () => textResponse(200, PUBLIC_PEM) },
    ]);

    const res = await useFirmStore.getState().signIn('lawyer@firm.com', 'pw-correct-horse');
    expect(res.ok).toBe(true);

    // Keychain holds the tokens under the user namespace.
    expect(keychainStore.get('com.keepance.user.user-1::access_token')).toBe('ACCESS_JWT');
    expect(keychainStore.get('com.keepance.user.user-1::refresh_token')).toBe('REFRESH_TOKEN');

    // localStorage must NOT contain the secrets.
    const lsDump = JSON.stringify(
      Object.fromEntries(
        Object.keys(localStorage).map((k) => [k, localStorage.getItem(k)]),
      ),
    );
    expect(lsDump).not.toContain('ACCESS_JWT');
    expect(lsDump).not.toContain('REFRESH_TOKEN');

    // Session metadata (non-secret) is in the store.
    expect(useFirmStore.getState().session?.email).toBe('lawyer@firm.com');
    expect(useFirmStore.getState().session?.org?.name).toBe('Firm LLP');
  });

  it('surfaces an auth error and does not store tokens', async () => {
    routeFetch([{ match: /\/auth\/login$/, res: () => jsonResponse(401, { error: 'invalid_credentials', detail: 'Bad email or password.' }) }]);
    const res = await useFirmStore.getState().signIn('lawyer@firm.com', 'wrong');
    expect(res.ok).toBe(false);
    expect(keychainStore.size).toBe(0);
  });
});

describe('firmStore seat activation', () => {
  async function signInOk() {
    routeFetch([
      { match: /\/auth\/login$/, res: () => jsonResponse(200, LOGIN_BODY) },
      { match: /\/auth\/me$/, res: () => jsonResponse(200, { user: LOGIN_BODY.user, org: null }) },
      { match: /seat-pubkey$/, res: () => textResponse(200, PUBLIC_PEM) },
    ]);
    await useFirmStore.getState().signIn('lawyer@firm.com', 'pw');
  }

  it('stores the seat token in the keychain and verifies it OFFLINE', async () => {
    await signInOk();
    const seatToken = seatTokenFor(Math.floor(Date.now() / 1000) + 3600);
    routeFetch([
      {
        match: /\/org\/activate$/,
        method: 'POST',
        res: () =>
          jsonResponse(200, {
            token: seatToken,
            seat_token: seatToken,
            tier: 'practice',
            packs: ['legal'],
            seats: 5,
            seat_id: 'seat-1',
            machine_id: 'm',
            expires_at: 'later',
          }),
      },
      { match: /seat-pubkey$/, res: () => textResponse(200, PUBLIC_PEM) },
    ]);

    const res = await useFirmStore.getState().activateSeat('KEEP-XXXX-XXXX-XXXX-XXXX', 'Work laptop');
    expect(res.ok).toBe(true);

    // Seat token in keychain.
    expect(keychainStore.get('com.keepance.user.user-1::seat_token')).toBe(seatToken);
    // Offline verification succeeded against the fetched public key.
    expect(useFirmStore.getState().offlineSeatValid).toBe(true);
    expect(useFirmStore.getState().serverVerdict).toBe('valid');
    expect(useFirmStore.getState().session?.activated).toBe(true);
  });

  it('an active seat yields the Firm entitlement (AI on, practice tier)', async () => {
    await signInOk();
    const seatToken = seatTokenFor(Math.floor(Date.now() / 1000) + 3600);
    routeFetch([
      {
        match: /\/org\/activate$/,
        res: () =>
          jsonResponse(200, {
            token: seatToken, seat_token: seatToken, tier: 'practice', packs: ['legal'],
            seats: 5, seat_id: 'seat-1', machine_id: 'm', expires_at: 'later',
          }),
      },
      { match: /seat-pubkey$/, res: () => textResponse(200, PUBLIC_PEM) },
    ]);
    await useFirmStore.getState().activateSeat('KEEP-1');

    const ent = selectFirmEntitlement(useFirmStore.getState());
    expect(ent.aiEnabled).toBe(true);
    expect(ent.entitledTier).toBe('practice');
    expect(ent.state).toBe('subscription-active');
    expect(ent.dataAccessAlwaysTrue).toBe(true);
  });

  it('surfaces a 409 seat-limit response so the UI can offer revoke/transfer', async () => {
    await signInOk();
    routeFetch([
      {
        match: /\/org\/activate$/,
        res: () =>
          jsonResponse(409, {
            error: 'seat_limit_exceeded',
            detail: 'All seats in use.',
            seat_limit: 5,
            seats: [],
          }),
      },
    ]);
    const res = await useFirmStore.getState().activateSeat('KEEP-1');
    expect(res.ok).toBe(false);
    expect(res.seatLimit?.error).toBe('seat_limit_exceeded');
    expect(res.seatLimit?.seat_limit).toBe(5);
  });
});

describe('firmStore admin actions hit the right endpoints', () => {
  async function signInAdmin() {
    routeFetch([
      { match: /\/auth\/login$/, res: () => jsonResponse(200, LOGIN_BODY) },
      { match: /\/auth\/me$/, res: () => jsonResponse(200, { user: LOGIN_BODY.user, org: null }) },
      { match: /seat-pubkey$/, res: () => textResponse(200, PUBLIC_PEM) },
    ]);
    await useFirmStore.getState().signIn('lawyer@firm.com', 'pw');
  }

  it('createMatter / addMatterMember / setWall / setProviderKey call the documented paths', async () => {
    await signInAdmin();
    const calls: Array<{ url: string; method: string; body: unknown }> = [];
    fetchMock.mockImplementation(async (url: string, init?: { method?: string; body?: string }) => {
      calls.push({ url, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(init.body) : undefined });
      if (/\/org\/matters$/.test(url)) return jsonResponse(201, { matter: { matter_id: 'mat-1', org_id: 'org-1', client_name: 'Acme', status: 'active', key_epoch: 1, created_at: 'now' } });
      if (/\/matter\/mat-1\/members\/add$/.test(url)) return jsonResponse(200, { ok: true, key_epoch: 1, key_release: 'release_to_member' });
      if (/\/matter\/mat-1\/wall\/set$/.test(url)) return jsonResponse(200, { ok: true, walled: true, key_epoch: 2 });
      if (/\/assured\/keys\/set$/.test(url)) return jsonResponse(200, { ok: true, provider: 'anthropic', key_last4: '1234' });
      throw new Error(`unmocked ${url}`);
    });

    const client = useFirmStore.getState().client();
    await client.createMatter('Acme');
    await client.addMatterMember('mat-1', 'user-2', 'editor');
    await client.setWall('mat-1', 'user-3', 'conflict');
    await client.setProviderKey('anthropic', 'sk-ant-MANAGED');

    expect(calls.find((c) => /\/org\/matters$/.test(c.url))?.method).toBe('POST');
    expect(calls.find((c) => /\/org\/matters$/.test(c.url))?.body).toEqual({ client_name: 'Acme' });

    const addCall = calls.find((c) => /members\/add$/.test(c.url));
    expect(addCall?.body).toEqual({ user_id: 'user-2', role: 'editor' });

    const wallCall = calls.find((c) => /wall\/set$/.test(c.url));
    expect(wallCall?.body).toEqual({ user_id: 'user-3', reason: 'conflict' });

    const keyCall = calls.find((c) => /assured\/keys\/set$/.test(c.url));
    expect(keyCall?.body).toEqual({ provider: 'anthropic', api_key: 'sk-ant-MANAGED' });
  });
});
