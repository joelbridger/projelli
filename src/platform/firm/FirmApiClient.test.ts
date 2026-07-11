import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/platform/providers/fetchUtils', () => ({
  getCorsSafeFetch: async () => fetch,
}));

import { FirmApiClient } from './FirmApiClient';
import { parseMatterHandle, parseStreamHandle } from './contract';

const matterHandle = parseMatterHandle(`mh2_${'A'.repeat(43)}`);
const streamHandle = parseStreamHandle(`sh2_${'B'.repeat(43)}`);

describe('FirmApiClient v2 relay privacy', () => {
  const traffic: Array<{ url: string; method: string; headers: string; body: string }> = [];

  beforeEach(() => {
    traffic.length = 0;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      traffic.push({
        url: String(input), method: init?.method ?? 'GET',
        headers: JSON.stringify(init?.headers ?? {}), body: typeof init?.body === 'string' ? init.body : '',
      });
      const url = String(input);
      const body = url.endsWith('/matters') ? {
        matter_handle: matterHandle, root_stream_handle: streamHandle, key_epoch: 1, status: 'provisioning',
      } : url.endsWith('/streams') ? { stream_handle: streamHandle } :
        url.includes('/updates') && (init?.method ?? 'GET') === 'GET' ?
          { key_epoch: 1, since: 0, cursor: 0, latest_cursor: 0, has_more: false, updates: [] } :
          url.endsWith('/sync-ticket') ? { ticket: 'ticket-opaque', expires_in_ms: 60_000 } : { ok: true, cursor: 1, blob_id: 'blob', key_epoch: 1, duplicate: false };
      return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }));
  });

  it('never serializes client or local routing metadata into v2 traffic', async () => {
    const client = new FirmApiClient({ getAccessToken: () => 'access', refreshAccessToken: async () => null });
    await client.createMatter();
    await client.activateMatter(matterHandle);
    await client.allocateStream(matterHandle);
    await client.pushUpdate(streamHandle, 'blob', 'ciphertext', 'seat', 1);
    await client.pullUpdates(streamHandle, 0, 'seat');
    await client.createSyncTicket(streamHandle, 'seat');
    const recorded = JSON.stringify(traffic);
    for (const secret of [
      'CLIENT_SECRET_NIMBUS', 'matter-semantic-123', 'local-matter-77', 'doc-advisory-plan.docx', 'Client plan.docx', '/clients/nimbus', 'doc_id', 'client_name', 'matter_id',
    ]) expect(recorded).not.toContain(secret);
    expect(traffic.map((r) => r.url).join('\n')).toContain('/v2/firm/streams/');
    expect(traffic.find((r) => r.url.includes('/updates?'))?.url).toMatch(/\?since=0$/);
  });

  it('accepts only strict 256-bit base64url opaque handles', () => {
    expect(parseMatterHandle(matterHandle)).toBe(matterHandle);
    expect(parseStreamHandle(streamHandle)).toBe(streamHandle);
    expect(() => parseMatterHandle('matter-semantic-123')).toThrow();
    expect(() => parseStreamHandle('sh2_short')).toThrow();
  });
});
