import { describe, expect, it } from 'vitest';
import { MatterSyncClient, type WebSocketLike } from './MatterSyncClient';
import { generateMatterKey } from './matterCrypto';
import { parseMatterHandle, parseStreamHandle } from './contract';

describe('MatterSyncClient v2 socket privacy', () => {
  it('opens the fixed ticket-only socket URL and accepts identifier-free frames', async () => {
    const urls: string[] = [];
    let socket: WebSocketLike | undefined;
    const fakeClient = {
      pullUpdates: () => Promise.resolve({ key_epoch: 1, since: 0, cursor: 0, latest_cursor: 0, has_more: false, updates: [] }),
      createSyncTicket: () => Promise.resolve({ ticket: 'ticket-only', expires_in_ms: 1000 }),
      pushUpdate: () => Promise.resolve({ ok: true, cursor: 1, blob_id: 'x', key_epoch: 1, duplicate: false }),
    };
    const client = new MatterSyncClient({
      matterHandle: parseMatterHandle(`mh2_${'A'.repeat(43)}`), streamHandle: parseStreamHandle(`sh2_${'B'.repeat(43)}`),
      keyB64: await generateMatterKey(), keyEpoch: 1, seatToken: 'seat', client: fakeClient as never,
      socketFactory: (url) => {
        urls.push(url);
        socket = { send() {}, close() {}, onopen: null, onclose: null, onerror: null, onmessage: null };
        return socket;
      },
    });
    await client.start();
    expect(urls).toHaveLength(1);
    const url = new URL(urls[0]!);
    expect(url.pathname).toMatch(/\/v2\/firm\/sync$/);
    expect([...url.searchParams.entries()]).toEqual([['ticket', 'ticket-only']]);
    socket?.onmessage?.({ data: JSON.stringify({ type: 'ready', backlog: 0, latest_cursor: 0, subscribers: 2 }) });
    socket?.onmessage?.({ data: JSON.stringify({ type: 'presence', count: 3 }) });
    expect(client.getPresenceCount()).toBe(3);
    client.stop();
  });
});
