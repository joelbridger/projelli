/**
 * FirmApiClient — SSO config methods (ssoConfigGet / ssoConfigSet / ssoConfigDelete).
 *
 * Mirrors the pattern in firmApiClient.test.ts: mock getCorsSafeFetch so no
 * real network is made, construct the client with a TokenSource, and assert
 * the correct URL + Authorization header.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the fetch the FirmApiClient uses; capture every call.
const fetchMock = vi.fn();
vi.mock('@/modules/models/fetchUtils', () => ({
  getCorsSafeFetch: async () => fetchMock as unknown as typeof fetch,
}));

import { FirmApiClient, type TokenSource } from '@/modules/firm/FirmApiClient';

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

const ACCESS = 'admin-access-token-abc';

function tokenSource(): TokenSource {
  return {
    getAccessToken: () => ACCESS,
    refreshAccessToken: async () => ACCESS,
  };
}

/** The (url, init) the client passed to fetch on its last call. */
function lastCall(): { url: string; init: RequestInit & { headers: Record<string, string> } } {
  const [url, init] = fetchMock.mock.calls[fetchMock.mock.calls.length - 1] as [
    string,
    RequestInit & { headers: Record<string, string> },
  ];
  return { url, init };
}

describe('FirmApiClient SSO config methods', () => {
  beforeEach(() => {
    fetchMock.mockReset();
  });

  it('ssoConfigGet POSTs to /org/sso/config/get with Bearer token', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { configured: false, redirect_uri: 'https://api.keepance.com/auth/sso/callback' }),
    );

    const client = new FirmApiClient(tokenSource());
    const view = await client.ssoConfigGet();

    expect(view.configured).toBe(false);
    expect(view.redirect_uri).toContain('/auth/sso/callback');

    const { url, init } = lastCall();
    expect(url).toContain('/org/sso/config/get');
    expect(init.method).toBe('POST');
    expect(init.headers['Authorization']).toBe(`Bearer ${ACCESS}`);
  });

  it('ssoConfigSet POSTs to /org/sso/config/set with Bearer token and body', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { ok: true, redirect_uri: 'https://api.keepance.com/auth/sso/callback' }),
    );

    const client = new FirmApiClient(tokenSource());
    const result = await client.ssoConfigSet({
      provider: 'entra',
      issuer: 'https://login.microsoftonline.com/tenant-123/v2.0',
      client_id: 'client-abc',
      client_secret: 'super-secret',
      enabled: true,
    });

    expect(result.ok).toBe(true);

    const { url, init } = lastCall();
    expect(url).toContain('/org/sso/config/set');
    expect(init.method).toBe('POST');
    expect(init.headers['Authorization']).toBe(`Bearer ${ACCESS}`);

    const sentBody = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(sentBody.provider).toBe('entra');
    expect(sentBody.issuer).toBe('https://login.microsoftonline.com/tenant-123/v2.0');
    expect(sentBody.client_id).toBe('client-abc');
  });

  it('ssoConfigDelete POSTs to /org/sso/config/delete with Bearer token', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { ok: true }));

    const client = new FirmApiClient(tokenSource());
    const result = await client.ssoConfigDelete();

    expect(result.ok).toBe(true);

    const { url, init } = lastCall();
    expect(url).toContain('/org/sso/config/delete');
    expect(init.method).toBe('POST');
    expect(init.headers['Authorization']).toBe(`Bearer ${ACCESS}`);
  });
});
