import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/platform/providers/fetchUtils', () => ({
  getCorsSafeFetch: () => Promise.resolve(fetch),
}));

import { FirmApiClient, FirmApiError, MAX_PULL_RESPONSE_BYTES } from './FirmApiClient';
import { parseIntakeHandle, parseMatterHandle, parseStreamHandle } from './contract';

const matterHandle = parseMatterHandle(`mh2_${'A'.repeat(43)}`);
const streamHandle = parseStreamHandle(`sh2_${'B'.repeat(43)}`);
const intakeHandle = parseIntakeHandle(`ih2_${'C'.repeat(43)}`);

describe('FirmApiClient v2 relay privacy', () => {
  const traffic: Array<{ url: string; method: string; headers: string; body: string }> = [];
  const parsedResponses: unknown[] = [];
  const sentinels = [
    'CLIENT_SECRET_NIMBUS', // client name
    'matter-semantic-123', // legacy semantic matter ID
    'local-matter-77', // local Matter.id
    'doc-advisory-plan.docx', // document ID
    'Client plan.docx', // filename
    '/clients/nimbus', // filesystem path
  ];

  beforeEach(() => {
    traffic.length = 0;
    parsedResponses.length = 0;
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      traffic.push({
        url, method: init?.method ?? 'GET',
        headers: JSON.stringify(init?.headers ?? {}), body: typeof init?.body === 'string' ? init.body : '',
      });
      const body = url.endsWith('/matters') ? {
        matter_handle: matterHandle, root_stream_handle: streamHandle, key_epoch: 1, status: 'provisioning',
      } : url.includes('/updates') && (init?.method ?? 'GET') === 'GET' ?
          { key_epoch: 1, since: 0, cursor: 0, latest_cursor: 0, has_more: false, updates: [] } :
          url.endsWith('/sync-ticket') ? { ticket: 'ticket-opaque', expires_in_ms: 60_000 } : { ok: true, cursor: 1, blob_id: 'blob', key_epoch: 1, duplicate: false };
      return Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    }));
  });

  it('keeps every v2 matter operation free of all six local-metadata sentinels', async () => {
    const client = new FirmApiClient({ getAccessToken: () => 'access', refreshAccessToken: () => Promise.resolve(null) });
    parsedResponses.push(
      await client.createMatter(`pn2_${'C'.repeat(43)}`),
      await client.activateMatter(matterHandle),
      await client.listMatters(),
      await client.matterMine('seat'),
      await client.listMatterMembers(matterHandle),
      await client.addMatterMember(matterHandle, 'user-opaque', 'editor'),
      await client.removeMatterMember(matterHandle, 'user-opaque'),
      await client.setWall(matterHandle, 'user-opaque'),
      await client.clearWall(matterHandle, 'user-opaque'),
      await client.publishMatterKeys(matterHandle, { epoch: 1, wrapped: [{ user_id: 'user-opaque', device_id: 'device-opaque', wrapped_key_b64: 'wrapped' }] }),
      await client.fetchMatterKeys(matterHandle, 'device-opaque', 'seat'),
      await client.publishIntakeKeys(intakeHandle, { matter_handle: matterHandle, epoch: 1, wrapped: [{ user_id: 'user-opaque', device_id: 'device-opaque', wrapped_key_b64: 'wrapped' }] }),
      await client.fetchIntakeKeys(intakeHandle, 'device-opaque', 'seat'),
      await client.pushUpdate(matterHandle, streamHandle, 'blob-opaque', 'ciphertext-opaque', 'seat', 1),
      await client.pullUpdates(streamHandle, 0, 'seat'),
      await client.createSyncTicket(streamHandle, 'seat', 0),
    );

    for (const request of traffic) {
      const url = new URL(request.url, 'http://firm.test');
      for (const secret of sentinels) {
        expect(url.pathname).not.toContain(secret);
        expect(url.search).not.toContain(secret);
        expect(request.headers).not.toContain(secret);
        expect(request.body).not.toContain(secret);
        expect(request.method).not.toContain(secret);
      }
      expect(url.searchParams.has('client_name')).toBe(false);
      expect(url.searchParams.has('matter_id')).toBe(false);
      expect(url.searchParams.has('doc_id')).toBe(false);
    }
    const parsedRouting = JSON.stringify(parsedResponses);
    for (const secret of sentinels) expect(parsedRouting).not.toContain(secret);
    expect(parsedRouting).not.toMatch(/client_name|matter_id|doc_id/);

    expect(traffic.map((r) => r.url).join('\n')).toContain(`/v2/firm/matters/${matterHandle}/streams/`);
    expect(traffic.find((r) => r.url.includes('/updates?'))?.url).toMatch(/\?since=0$/);
    expect(traffic).toHaveLength(16);
  });

  it('accepts only strict 256-bit base64url opaque handles', () => {
    expect(parseMatterHandle(matterHandle)).toBe(matterHandle);
    expect(parseStreamHandle(streamHandle)).toBe(streamHandle);
    expect(parseIntakeHandle(intakeHandle)).toBe(intakeHandle);
    expect(() => parseMatterHandle('matter-semantic-123')).toThrow();
    expect(() => parseStreamHandle('sh2_short')).toThrow();
    expect(() => parseIntakeHandle('intake-semantic-123')).toThrow();
  });

  it('rejects an oversized pull response before buffering the whole body', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array(MAX_PULL_RESPONSE_BYTES + 1));
          controller.close();
        },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ))));
    const client = new FirmApiClient({ getAccessToken: () => 'access', refreshAccessToken: () => Promise.resolve(null) });
    await expect(client.pullUpdates(streamHandle, 0, 'seat')).rejects.toMatchObject({
      code: 'response_too_large',
    } satisfies Partial<FirmApiError>);
  });
});
