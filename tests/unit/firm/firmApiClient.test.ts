/**
 * FirmApiClient — wire-shape tests for the two secrets-in-URL fixes.
 *
 *   - pullUpdates sends the seat token in the X-Seat-Token HEADER, with NO
 *     seat_token in the URL/query (only `since` is a query param).
 *   - createSyncTicket is an authed POST that carries the seat token in the
 *     X-Seat-Token header (never the URL) and hits /matter/:id/sync-ticket.
 *
 * The CORS-safe fetch is mocked so we can inspect exactly what URL + headers the
 * client emits. No network.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the fetch the FirmApiClient uses; capture every call.
const fetchMock = vi.fn();
vi.mock('@/platform/providers/fetchUtils', () => ({
  getCorsSafeFetch: async () => fetchMock as unknown as typeof fetch,
}));

import { FirmApiClient, type TokenSource } from '@/platform/firm/FirmApiClient';

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

const ACCESS = 'ACCESS_JWT_SECRET';
const SEAT = 'SEAT_TOKEN_SECRET';

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

describe('FirmApiClient — no seat token in any URL', () => {
  beforeEach(() => {
    fetchMock.mockReset();
  });

  it('pullUpdates sends X-Seat-Token header and keeps the token OUT of the URL', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        matter_id: 'm1',
        key_epoch: 1,
        since: 0,
        cursor: 0,
        latest_cursor: 0,
        has_more: false,
        updates: [],
      }),
    );

    const client = new FirmApiClient(tokenSource());
    await client.pullUpdates('m1', 7, SEAT);

    const { url, init } = lastCall();
    // since rides as a query param; the seat token does NOT.
    expect(url).toContain('/matter/m1/updates');
    expect(url).toContain('since=7');
    expect(url).not.toContain('seat_token');
    expect(url).not.toContain(SEAT);
    // The seat token is in the header instead.
    expect(init.headers['X-Seat-Token']).toBe(SEAT);
    // Authed via Authorization header.
    expect(init.headers['Authorization']).toBe(`Bearer ${ACCESS}`);
  });

  it('createSyncTicket POSTs to /sync-ticket with the seat token in a header, not the URL', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { ticket: 'TICKET_123', expires_in_ms: 30000 }));

    const client = new FirmApiClient(tokenSource());
    const res = await client.createSyncTicket('m1', SEAT);
    expect(res.ticket).toBe('TICKET_123');

    const { url, init } = lastCall();
    expect(init.method).toBe('POST');
    expect(url).toContain('/matter/m1/sync-ticket');
    expect(url).not.toContain('seat_token');
    expect(url).not.toContain('access_token');
    expect(url).not.toContain(SEAT);
    expect(url).not.toContain(ACCESS);
    expect(init.headers['X-Seat-Token']).toBe(SEAT);
    expect(init.headers['Authorization']).toBe(`Bearer ${ACCESS}`);
  });
});
