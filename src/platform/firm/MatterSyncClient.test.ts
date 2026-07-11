import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
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
    const socketUrl = urls[0];
    expect(socketUrl).toBeDefined();
    const url = new URL(socketUrl ?? '');
    expect(url.pathname).toMatch(/\/v2\/firm\/sync$/);
    expect([...url.searchParams.entries()]).toEqual([['ticket', 'ticket-only']]);
    socket?.onmessage?.({ data: JSON.stringify({ type: 'ready', backlog: 0, latest_cursor: 0, subscribers: 2 }) });
    socket?.onmessage?.({ data: JSON.stringify({ type: 'presence', count: 3 }) });
    expect(client.getPresenceCount()).toBe(3);
    client.stop();
  });

  it('hard-rejects legacy v1 history', async () => {
    const matterHandle = parseMatterHandle(`mh2_${'C'.repeat(43)}`);
    const streamHandle = parseStreamHandle(`sh2_${'D'.repeat(43)}`);
    const keyB64 = await generateMatterKey();
    const ciphertext_b64 = btoa(String.fromCharCode(1, ...new Uint8Array(12 + 16)));
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

  it('flushes only writes present at its starting marker, even while later edits keep arriving', async () => {
    let resolveFirstPush: (() => void) | undefined;
    let pushes = 0;
    const doc = new Y.Doc();
    const client = new MatterSyncClient({
      matterHandle: parseMatterHandle(`mh2_${'E'.repeat(43)}`), streamHandle: parseStreamHandle(`sh2_${'F'.repeat(43)}`),
      keyB64: await generateMatterKey(), keyEpoch: 1, seatToken: 'seat', doc,
      client: {
        pullUpdates: () => Promise.resolve({ key_epoch: 1, since: 0, cursor: 0, latest_cursor: 0, has_more: false, updates: [] }),
        createSyncTicket: () => Promise.resolve({ ticket: 'ticket-only', expires_in_ms: 1000 }),
        pushUpdate: () => {
          pushes += 1;
          if (pushes === 1) return new Promise((resolve) => { resolveFirstPush = () => { resolve({ ok: true, cursor: 1, blob_id: 'first', key_epoch: 1, duplicate: false }); }; });
          return new Promise(() => undefined);
        },
      } as never,
      socketFactory: () => ({ send() {}, close() {}, onopen: null, onclose: null, onerror: null, onmessage: null }),
    });
    await client.start();
    doc.getMap('root').set('document-creation', true);
    for (let tries = 0; !resolveFirstPush && tries < 20; tries += 1) await new Promise((resolve) => setTimeout(resolve, 1));
    expect(resolveFirstPush).toBeDefined();

    const flushed = client.flush();
    // These represent a steady editor continuing to type after creation began.
    for (let i = 0; i < 10; i += 1) doc.getMap('root').set(`later-${String(i)}`, i);
    resolveFirstPush?.();

    await expect(Promise.race([
      flushed,
      new Promise<void>((_resolve, reject) => setTimeout(() => { reject(new Error('flush waited for later edits')); }, 100)),
    ])).resolves.toBeUndefined();
    client.stop();
  });

  it('aborts a slow pre-existing root write when its bounded flush deadline elapses', async () => {
    const doc = new Y.Doc();
    let sawAbort = false;
    let pushStarted = false;
    const client = new MatterSyncClient({
      matterHandle: parseMatterHandle(`mh2_${'G'.repeat(43)}`), streamHandle: parseStreamHandle(`sh2_${'H'.repeat(43)}`),
      keyB64: await generateMatterKey(), keyEpoch: 1, seatToken: 'seat', doc,
      client: {
        pullUpdates: () => Promise.resolve({ key_epoch: 1, since: 0, cursor: 0, latest_cursor: 0, has_more: false, updates: [] }),
        createSyncTicket: () => Promise.resolve({ ticket: 'ticket-only', expires_in_ms: 1000 }),
        pushUpdate: (_stream: string, _blob: string, _ciphertext: string, _seat: string, _epoch: number, signal?: AbortSignal) => new Promise((_resolve, reject) => { pushStarted = true; signal?.addEventListener('abort', () => { sawAbort = true; reject(new Error('aborted')); }, { once: true }); }),
      } as never,
      socketFactory: () => ({ send() {}, close() {}, onopen: null, onclose: null, onerror: null, onmessage: null }),
    });
    await client.start();
    doc.getMap('root').set('slow-write', true);
    for (let tries = 0; tries < 10; tries += 1) await new Promise((resolve) => setTimeout(resolve, 1));
    expect(pushStarted).toBe(true);
    const deadline = new AbortController();
    const flush = client.flush({ signal: deadline.signal });
    deadline.abort();
    await expect(flush).rejects.toThrow('before the stream lease deadline');
    expect(sawAbort).toBe(true);
    client.stop();
  });
});
