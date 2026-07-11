import { afterEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { MatterSyncClient, type WebSocketLike } from './MatterSyncClient';
import { encryptUpdate, generateMatterKey, importMatterKey } from './matterCrypto';
import { parseMatterHandle, parseStreamHandle } from './contract';

afterEach(() => vi.unstubAllEnvs());

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

  it('hard-rejects legacy v1 history after the migration deadline', async () => {
    vi.stubEnv('VITE_FIRM_V1_CRYPTO_READ_DEADLINE', '2000-01-01T00:00:00.000Z');
    const matterHandle = parseMatterHandle(`mh2_${'C'.repeat(43)}`);
    const streamHandle = parseStreamHandle(`sh2_${'D'.repeat(43)}`);
    const keyB64 = await generateMatterKey();
    const legacyDoc = new Y.Doc();
    legacyDoc.getMap('history').set('migrated-note', 'still readable');
    const ciphertext_b64 = await encryptUpdate(
      await importMatterKey(keyB64),
      Y.encodeStateAsUpdate(legacyDoc),
      1,
    );
    const fakeClient = {
      pullUpdates: () => Promise.resolve({
        key_epoch: 1, since: 0, cursor: 1, latest_cursor: 1, has_more: false,
        updates: [{ cursor: 1, blob_id: 'legacy-blob', key_epoch: 1, ciphertext_b64 }],
      }),
      createSyncTicket: () => Promise.resolve({ ticket: 'ticket-only', expires_in_ms: 1000 }),
      pushUpdate: () => Promise.resolve({ ok: true, cursor: 2, blob_id: 'new', key_epoch: 1, duplicate: false }),
    };
    const client = new MatterSyncClient({
      matterHandle, streamHandle, keyB64, keyEpoch: 1, seatToken: 'seat', client: fakeClient as never,
      socketFactory: () => ({ send() {}, close() {}, onopen: null, onclose: null, onerror: null, onmessage: null }),
    });

    await client.start();

    expect(client.doc.getMap('history').get('migrated-note')).toBeUndefined();
    client.stop();
  });
});
