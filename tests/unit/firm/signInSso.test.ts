/**
 * signInSso — verifies that the SSO store action runs the IDENTICAL post-login
 * path as signIn: storeAuthTokens -> set accessToken -> me() -> getSeatPublicKey()
 * -> persist session, with the same field names, error flags, and validateSeat
 * follow-up.
 *
 * Mocking strategy mirrors firmStore.test.ts exactly:
 *   - @tauri-apps/api/core: invoke handles both keychain_* commands AND the new
 *     firm_sso_authenticate command.
 *   - @/modules/models/fetchUtils: getCorsSafeFetch returns our fetchMock.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── keychain store (shared across keychain_* and firm_sso_authenticate invokes)
const keychainStore = new Map<string, string>();

const SSO_LOGIN_RESPONSE = {
  user: { user_id: 'u-sso-1', email: 'jane@weston.com', role: 'member', status: 'active', created_at: '2026-01-01T00:00:00Z' },
  access_token: 'SSO_ACCESS',
  access_expires_at: '2026-12-31T00:00:00Z',
  refresh_token: 'SSO_REFRESH',
  refresh_expires_at: '2027-06-30T00:00:00Z',
};

const invokeMock = vi.fn(async (cmd: string, args: Record<string, unknown> = {}) => {
  // Keychain commands
  if (cmd === 'keychain_set') {
    const svc = (args['service'] as string) ?? 'com.lantern.app';
    const key = args['key'] as string;
    keychainStore.set(`${svc}::${key}`, args['value'] as string);
    return undefined;
  }
  if (cmd === 'keychain_get') {
    const svc = (args['service'] as string) ?? 'com.lantern.app';
    const key = args['key'] as string;
    const id = `${svc}::${key}`;
    if (!keychainStore.has(id)) throw { kind: 'notFound', message: 'no entry' };
    return keychainStore.get(id);
  }
  if (cmd === 'keychain_delete') {
    const svc = (args['service'] as string) ?? 'com.lantern.app';
    const key = args['key'] as string;
    keychainStore.delete(`${svc}::${key}`);
    return undefined;
  }
  // SSO command — returns LoginResponse JSON string
  if (cmd === 'firm_sso_authenticate') {
    return JSON.stringify(SSO_LOGIN_RESPONSE);
  }
  // The Rust-side cancel flag is irrelevant once firm_sso_authenticate has
  // already resolved — real behavior for this mock is just "no-op, Ok(())".
  if (cmd === 'firm_sso_cancel') {
    return undefined;
  }
  throw new Error(`unexpected invoke: ${cmd}`);
});

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...a: unknown[]) => invokeMock(...(a as [string, Record<string, unknown>])),
  isTauri: () => true,
}));

// ── Mock the CORS-safe fetch the FirmApiClient uses
const fetchMock = vi.fn();
vi.mock('@/platform/providers/fetchUtils', () => ({
  getCorsSafeFetch: async () => fetchMock as unknown as typeof fetch,
}));

import { useFirmStore } from '@/platform/firm/firmStore';

// Canned org returned by /auth/me
const ME_RESPONSE = {
  user: SSO_LOGIN_RESPONSE.user,
  org: { org_id: 'org-1', name: 'Weston LLP', plan: 'practice', packs: ['legal'], seat_limit: 5 },
};

const PUBLIC_PEM = '-----BEGIN PUBLIC KEY-----\nMFIwEAYHKoZIzj0CAQYFK4EEAAMDPgAENOTREAL=\n-----END PUBLIC KEY-----\n';

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

describe('firmStore.signInSso', () => {
  it('calls firm_sso_authenticate with backendBase + email', async () => {
    routeFetch([
      { match: /\/auth\/me$/, res: () => jsonResponse(200, ME_RESPONSE) },
      { match: /seat-pubkey$/, res: () => textResponse(200, PUBLIC_PEM) },
    ]);

    await useFirmStore.getState().signInSso('jane@weston.com');

    const ssoCall = invokeMock.mock.calls.find(([cmd]) => cmd === 'firm_sso_authenticate');
    expect(ssoCall).toBeDefined();
    const ssoArgs = ssoCall![1] as Record<string, unknown>;
    expect(typeof ssoArgs['backendBase']).toBe('string');
    expect(ssoArgs['email']).toBe('jane@weston.com');
  });

  it('stores access + refresh tokens in the OS keychain (same path as signIn)', async () => {
    routeFetch([
      { match: /\/auth\/me$/, res: () => jsonResponse(200, ME_RESPONSE) },
      { match: /seat-pubkey$/, res: () => textResponse(200, PUBLIC_PEM) },
    ]);

    await useFirmStore.getState().signInSso('jane@weston.com');

    expect(keychainStore.get('com.lantern.user.u-sso-1::access_token')).toBe('SSO_ACCESS');
    expect(keychainStore.get('com.lantern.user.u-sso-1::refresh_token')).toBe('SSO_REFRESH');

    // Secrets must NOT be in localStorage
    const lsDump = JSON.stringify(
      Object.fromEntries(Object.keys(localStorage).map((k) => [k, localStorage.getItem(k)])),
    );
    expect(lsDump).not.toContain('SSO_ACCESS');
    expect(lsDump).not.toContain('SSO_REFRESH');
  });

  it('populates accessToken and session with the same shape signIn uses', async () => {
    routeFetch([
      { match: /\/auth\/me$/, res: () => jsonResponse(200, ME_RESPONSE) },
      { match: /seat-pubkey$/, res: () => textResponse(200, PUBLIC_PEM) },
    ]);

    await useFirmStore.getState().signInSso('jane@weston.com');

    const st = useFirmStore.getState();
    // Runtime access token set
    expect(st.accessToken).toBe('SSO_ACCESS');
    // Session uses flattened fields (no nested user object — same as signIn)
    expect(st.session?.userId).toBe('u-sso-1');
    expect(st.session?.email).toBe('jane@weston.com');
    expect(st.session?.role).toBe('member');
    // Org populated from me()
    expect(st.session?.org?.name).toBe('Weston LLP');
    expect(st.session?.org?.org_id).toBe('org-1');
    // Loading cleared
    expect(st.isLoading).toBe(false);
    expect(st.error).toBeNull();
    // isOffline cleared
    expect(st.isOffline).toBe(false);
  });

  it('caches seatPublicKeyPem from getSeatPublicKey (same as signIn)', async () => {
    routeFetch([
      { match: /\/auth\/me$/, res: () => jsonResponse(200, ME_RESPONSE) },
      { match: /seat-pubkey$/, res: () => textResponse(200, PUBLIC_PEM) },
    ]);

    await useFirmStore.getState().signInSso('jane@weston.com');
    expect(useFirmStore.getState().seatPublicKeyPem).toBe(PUBLIC_PEM);
  });

  it('sets isLoading=true during sign-in and clears it on success', async () => {
    const loadingDuringSignIn: boolean[] = [];
    const unsub = useFirmStore.subscribe((s) => {
      if (s.isLoading) loadingDuringSignIn.push(true);
    });

    routeFetch([
      { match: /\/auth\/me$/, res: () => jsonResponse(200, ME_RESPONSE) },
      { match: /seat-pubkey$/, res: () => textResponse(200, PUBLIC_PEM) },
    ]);

    await useFirmStore.getState().signInSso('jane@weston.com');
    unsub();

    expect(loadingDuringSignIn.length).toBeGreaterThan(0);
    expect(useFirmStore.getState().isLoading).toBe(false);
  });

  it('sets error and rethrows on Tauri command failure', async () => {
    invokeMock.mockImplementationOnce(async (cmd: string) => {
      if (cmd === 'firm_sso_authenticate') throw new Error('sso_unavailable');
      // fall through for any other command (shouldn't happen in this path)
      throw new Error(`unexpected: ${cmd}`);
    });

    await expect(useFirmStore.getState().signInSso('unknown@other.com')).rejects.toThrow('sso_unavailable');
    const st = useFirmStore.getState();
    expect(st.isLoading).toBe(false);
    expect(st.error).toBe('sso_unavailable');
  });

  // F2.4: a user-initiated Cancel is an intentional exit, not a failure — it
  // must not surface as a store-level error, even though it still rejects
  // (so the caller's UI can distinguish "settled" from "still pending").
  it('rejecting with "cancelled" clears isLoading without setting a store error', async () => {
    invokeMock.mockImplementationOnce(async (cmd: string) => {
      if (cmd === 'firm_sso_authenticate') throw new Error('cancelled');
      throw new Error(`unexpected: ${cmd}`);
    });

    await expect(useFirmStore.getState().signInSso('jane@weston.com')).rejects.toThrow('cancelled');
    const st = useFirmStore.getState();
    expect(st.isLoading).toBe(false);
    expect(st.error).toBeNull();
    expect(st.session).toBeNull();
  });

  // Real Tauri behavior: invoke() rejects a `Result<T, String>` command's Err
  // with the RAW STRING, not an Error instance — `firm_sso_cancel` produces
  // exactly this shape. A prior version of this catch block only checked
  // FirmApiError/Error and fell through to "SSO sign-in failed" for a raw
  // string, misreporting a real user-initiated cancel as a failure.
  it('rejecting with the raw string "cancelled" (Tauri Err(String) shape) is still recognized as cancelled', async () => {
    invokeMock.mockImplementationOnce(async (cmd: string) => {
      // eslint-disable-next-line @typescript-eslint/only-throw-error
      if (cmd === 'firm_sso_authenticate') throw 'cancelled';
      throw new Error(`unexpected: ${cmd}`);
    });

    await expect(useFirmStore.getState().signInSso('jane@weston.com')).rejects.toThrow('cancelled');
    const st = useFirmStore.getState();
    expect(st.isLoading).toBe(false);
    expect(st.error).toBeNull();
    expect(st.session).toBeNull();
  });

  it('signInSsoCancel invokes firm_sso_cancel', async () => {
    invokeMock.mockImplementationOnce(async (cmd: string) => {
      if (cmd === 'firm_sso_cancel') return undefined;
      throw new Error(`unexpected: ${cmd}`);
    });

    await useFirmStore.getState().signInSsoCancel();

    const cancelCall = invokeMock.mock.calls.find(([cmd]) => cmd === 'firm_sso_cancel');
    expect(cancelCall).toBeDefined();
  });

  it('carries forward prior session seatId/tier when re-signing in as the same user', async () => {
    // Pre-populate a prior session for the same user with an activated seat
    useFirmStore.setState({
      session: {
        userId: 'u-sso-1',
        email: 'jane@weston.com',
        role: 'member',
        org: null,
        seatId: 'seat-existing',
        tier: 'practice',
        packs: ['legal'],
        seats: 3,
        lastValidatedAt: '2026-06-01T00:00:00Z',
        activated: false,
      },
    });

    routeFetch([
      { match: /\/auth\/me$/, res: () => jsonResponse(200, ME_RESPONSE) },
      { match: /seat-pubkey$/, res: () => textResponse(200, PUBLIC_PEM) },
    ]);

    await useFirmStore.getState().signInSso('jane@weston.com');

    const st = useFirmStore.getState();
    // Prior seat carry-forward (same user, same as signIn behavior)
    expect(st.session?.seatId).toBe('seat-existing');
    expect(st.session?.tier).toBe('practice');
  });

  // F2.4 follow-up (found in codex review): firm_sso_authenticate already
  // resolved (redirect + code exchange both completed) by the time
  // establishSessionFromLogin runs — storeAuthTokens writes the keychain
  // credential as its FIRST step, then makes further network calls (me(),
  // getSeatPublicKey()). A Cancel click any time during that window must
  // not leave the user silently signed in with a stored credential.
  it('cancel arriving during establishSessionFromLogin (after tokens are already stored) rolls back the credential and leaves no session', async () => {
    let cancelledDuringSeatPubkeyFetch = false;
    routeFetch([
      { match: /\/auth\/me$/, res: () => jsonResponse(200, ME_RESPONSE) },
      {
        match: /seat-pubkey$/,
        res: () => {
          // Simulate the user clicking Cancel while establishSessionFromLogin
          // is still in flight — storeAuthTokens has already run by now.
          cancelledDuringSeatPubkeyFetch = true;
          void useFirmStore.getState().signInSsoCancel();
          return textResponse(200, PUBLIC_PEM);
        },
      },
    ]);

    await expect(useFirmStore.getState().signInSso('jane@weston.com')).rejects.toThrow('cancelled');
    expect(cancelledDuringSeatPubkeyFetch).toBe(true);

    const st = useFirmStore.getState();
    expect(st.session).toBeNull();
    expect(st.accessToken).toBeNull();
    expect(st.isLoading).toBe(false);
    expect(st.error).toBeNull();

    // The credential storeAuthTokens wrote during establishSessionFromLogin
    // must be rolled back — NO credential may survive a cancel.
    expect(keychainStore.get('com.lantern.user.u-sso-1::access_token')).toBeUndefined();
    expect(keychainStore.get('com.lantern.user.u-sso-1::refresh_token')).toBeUndefined();
  });
});
