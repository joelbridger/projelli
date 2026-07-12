import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { MatterSyncClient, type WebSocketLike } from './MatterSyncClient';
import { decryptUpdateV2, generateMatterKey, importMatterKey } from './matterCrypto';
import { parseMatterHandle, parseStreamHandle } from './contract';

const opaqueBlobId = (character: string): string => `bh2_${character.repeat(43)}`;

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
        updates: [{ cursor: 1, blob_id: opaqueBlobId('L'), key_epoch: 1, ciphertext_b64 }],
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

  it('does not advance past a newer-epoch blob, then applies it after the fetched key rotates', async () => {
    const matterHandle = parseMatterHandle(`mh2_${'R'.repeat(43)}`);
    const streamHandle = parseStreamHandle(`sh2_${'S'.repeat(43)}`);
    const epochOneKey = await generateMatterKey();
    const epochTwoKey = await generateMatterKey();
    const source = new Y.Doc();
    source.getMap('notes').set('survives-rotation', 'yes');
    const ciphertext_b64 = await (await import('./matterCrypto')).encryptUpdateV2(
      await importMatterKey(epochTwoKey), Y.encodeStateAsUpdate(source), { matterHandle, streamHandle, keyEpoch: 2 },
    );
    const requestedEpochs: number[] = [];
    const client = new MatterSyncClient({
      matterHandle, streamHandle, keyB64: epochOneKey, keyEpoch: 1, seatToken: 'seat',
      client: {
        pullUpdates: (_stream: string, since: number) => Promise.resolve(since === 0
          ? { key_epoch: 2, since, cursor: 7, latest_cursor: 7, has_more: false, updates: [{ cursor: 7, blob_id: opaqueBlobId('E'), key_epoch: 2, ciphertext_b64 }] }
          : { key_epoch: 2, since, cursor: since, latest_cursor: 7, has_more: false, updates: [] }),
        createSyncTicket: () => Promise.resolve({ ticket: 'ticket-only', expires_in_ms: 1000 }),
        pushUpdate: () => Promise.resolve({ ok: true, cursor: 8, blob_id: 'new', key_epoch: 2, duplicate: false }),
      } as never,
      callbacks: { onKeyEpochAdvanced: (epoch) => requestedEpochs.push(epoch) },
      socketFactory: () => ({ send() {}, close() {}, onopen: null, onclose: null, onerror: null, onmessage: null }),
    });

    await client.start();
    expect(client.getCursor()).toBe(0);
    expect(requestedEpochs).toContain(2);
    await client.rotateKey(epochTwoKey, 2);
    expect(client.getCursor()).toBe(7);
    expect(client.doc.getMap('notes').get('survives-rotation')).toBe('yes');
    client.stop();
  });

  it('quarantines an authenticated but structurally invalid Yjs update and still applies the later update', async () => {
    const matterHandle = parseMatterHandle(`mh2_${'T'.repeat(43)}`);
    const streamHandle = parseStreamHandle(`sh2_${'U'.repeat(43)}`);
    const keyB64 = await generateMatterKey();
    const key = await importMatterKey(keyB64);
    // This is valid AES-GCM ciphertext, but not a valid Yjs update payload.
    const corruptCiphertext = await (await import('./matterCrypto')).encryptUpdateV2(
      key, new Uint8Array([0xff]), { matterHandle, streamHandle, keyEpoch: 1 },
    );
    const later = new Y.Doc();
    later.getMap('notes').set('later-update-survived', true);
    const laterCiphertext = await (await import('./matterCrypto')).encryptUpdateV2(
      key, Y.encodeStateAsUpdate(later), { matterHandle, streamHandle, keyEpoch: 1 },
    );
    const loud = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const onUpdateQuarantined = vi.fn();
    const client = new MatterSyncClient({
      matterHandle, streamHandle, keyB64, keyEpoch: 1, seatToken: 'seat',
      client: {
        pullUpdates: () => Promise.resolve({ key_epoch: 1, since: 0, cursor: 2, latest_cursor: 2, has_more: false, updates: [
          { cursor: 1, blob_id: opaqueBlobId('C'), key_epoch: 1, ciphertext_b64: corruptCiphertext },
          { cursor: 2, blob_id: opaqueBlobId('D'), key_epoch: 1, ciphertext_b64: laterCiphertext },
        ] }),
        createSyncTicket: () => Promise.resolve({ ticket: 'ticket-only', expires_in_ms: 1000 }),
        pushUpdate: () => Promise.resolve({ ok: true, cursor: 3, blob_id: 'new', key_epoch: 1, duplicate: false }),
      } as never,
      callbacks: { onUpdateQuarantined },
      socketFactory: () => ({ send() {}, close() {}, onopen: null, onclose: null, onerror: null, onmessage: null }),
    });

    await client.start();
    expect(client.getCursor()).toBe(2);
    expect(client.doc.getMap('notes').get('later-update-survived')).toBe(true);
    expect(loud).toHaveBeenCalledWith('[MatterSyncClient] quarantined corrupt remote update', expect.objectContaining({
      reason: 'yjs_apply_failed', blobId: opaqueBlobId('C'), cursor: 1,
    }));
    expect(onUpdateQuarantined).toHaveBeenCalledWith({ reason: 'yjs_apply_failed', blobId: opaqueBlobId('C') });
    loud.mockRestore();
    client.stop();
  });

  it('quarantines a current-epoch decrypt failure and still applies the later update', async () => {
    const matterHandle = parseMatterHandle(`mh2_${'V'.repeat(43)}`);
    const streamHandle = parseStreamHandle(`sh2_${'W'.repeat(43)}`);
    const keyB64 = await generateMatterKey();
    const key = await importMatterKey(keyB64);
    const sealed = await (await import('./matterCrypto')).encryptUpdateV2(
      key, Y.encodeStateAsUpdate(new Y.Doc()), { matterHandle, streamHandle, keyEpoch: 1 },
    );
    const tamperedCiphertext = `${sealed.slice(0, -1)}${sealed.endsWith('A') ? 'B' : 'A'}`;
    const later = new Y.Doc();
    later.getMap('notes').set('after-tamper', 'applied');
    const laterCiphertext = await (await import('./matterCrypto')).encryptUpdateV2(
      key, Y.encodeStateAsUpdate(later), { matterHandle, streamHandle, keyEpoch: 1 },
    );
    const loud = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const onUpdateQuarantined = vi.fn();
    const client = new MatterSyncClient({
      matterHandle, streamHandle, keyB64, keyEpoch: 1, seatToken: 'seat',
      client: {
        pullUpdates: () => Promise.resolve({ key_epoch: 1, since: 0, cursor: 2, latest_cursor: 2, has_more: false, updates: [
          { cursor: 1, blob_id: opaqueBlobId('T'), key_epoch: 1, ciphertext_b64: tamperedCiphertext },
          { cursor: 2, blob_id: opaqueBlobId('V'), key_epoch: 1, ciphertext_b64: laterCiphertext },
        ] }),
        createSyncTicket: () => Promise.resolve({ ticket: 'ticket-only', expires_in_ms: 1000 }),
        pushUpdate: () => Promise.resolve({ ok: true, cursor: 3, blob_id: 'new', key_epoch: 1, duplicate: false }),
      } as never,
      callbacks: { onUpdateQuarantined },
      socketFactory: () => ({ send() {}, close() {}, onopen: null, onclose: null, onerror: null, onmessage: null }),
    });

    await client.start();
    expect(client.getCursor()).toBe(2);
    expect(client.doc.getMap('notes').get('after-tamper')).toBe('applied');
    expect(loud).toHaveBeenCalledWith('[MatterSyncClient] quarantined corrupt remote update', expect.objectContaining({
      reason: 'decrypt_failed', blobId: opaqueBlobId('T'), cursor: 1,
    }));
    loud.mockRestore();
    client.stop();
  });

  it('labels an older-epoch decrypt failure as superseded and still applies the later update', async () => {
    const matterHandle = parseMatterHandle(`mh2_${'X'.repeat(43)}`);
    const streamHandle = parseStreamHandle(`sh2_${'Y'.repeat(43)}`);
    const oldKeyB64 = await generateMatterKey();
    const currentKeyB64 = await generateMatterKey();
    const oldCiphertext = await (await import('./matterCrypto')).encryptUpdateV2(
      await importMatterKey(oldKeyB64), Y.encodeStateAsUpdate(new Y.Doc()), { matterHandle, streamHandle, keyEpoch: 1 },
    );
    const later = new Y.Doc();
    later.getMap('notes').set('after-superseded-epoch', 'applied');
    const laterCiphertext = await (await import('./matterCrypto')).encryptUpdateV2(
      await importMatterKey(currentKeyB64), Y.encodeStateAsUpdate(later), { matterHandle, streamHandle, keyEpoch: 2 },
    );
    const loud = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const onUpdateQuarantined = vi.fn();
    const client = new MatterSyncClient({
      matterHandle, streamHandle, keyB64: currentKeyB64, keyEpoch: 2, seatToken: 'seat',
      client: {
        pullUpdates: () => Promise.resolve({ key_epoch: 2, since: 0, cursor: 2, latest_cursor: 2, has_more: false, updates: [
          { cursor: 1, blob_id: opaqueBlobId('O'), key_epoch: 1, ciphertext_b64: oldCiphertext },
          { cursor: 2, blob_id: opaqueBlobId('P'), key_epoch: 2, ciphertext_b64: laterCiphertext },
        ] }),
        createSyncTicket: () => Promise.resolve({ ticket: 'ticket-only', expires_in_ms: 1000 }),
        pushUpdate: () => Promise.resolve({ ok: true, cursor: 3, blob_id: 'new', key_epoch: 2, duplicate: false }),
      } as never,
      callbacks: { onUpdateQuarantined },
      socketFactory: () => ({ send() {}, close() {}, onopen: null, onclose: null, onerror: null, onmessage: null }),
    });

    await client.start();
    expect(client.getCursor()).toBe(2);
    expect(client.doc.getMap('notes').get('after-superseded-epoch')).toBe('applied');
    expect(loud).toHaveBeenCalledWith('[MatterSyncClient] skipped remote update sealed under a superseded key epoch', expect.objectContaining({
      reason: 'epoch_superseded', blobId: opaqueBlobId('O'), cursor: 1,
    }));
    expect(onUpdateQuarantined).toHaveBeenCalledWith({ reason: 'epoch_superseded', blobId: opaqueBlobId('O') });
    loud.mockRestore();
    client.stop();
  });

  it('quarantines an invalid pulled blob ID without surfacing it, then applies the later update', async () => {
    const matterHandle = parseMatterHandle(`mh2_${'Q'.repeat(43)}`);
    const streamHandle = parseStreamHandle(`sh2_${'R'.repeat(43)}`);
    const keyB64 = await generateMatterKey();
    const key = await importMatterKey(keyB64);
    const later = new Y.Doc();
    later.getMap('notes').set('after-invalid-pulled-id', 'applied');
    const laterCiphertext = await (await import('./matterCrypto')).encryptUpdateV2(
      key, Y.encodeStateAsUpdate(later), { matterHandle, streamHandle, keyEpoch: 1 },
    );
    const invalidBlobId = 'CLIENT_SECRET_NIMBUS';
    const loud = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const onUpdateQuarantined = vi.fn();
    const client = new MatterSyncClient({
      matterHandle, streamHandle, keyB64, keyEpoch: 1, seatToken: 'seat',
      client: {
        pullUpdates: () => Promise.resolve({ key_epoch: 1, since: 0, cursor: 2, latest_cursor: 2, has_more: false, updates: [
          { cursor: 1, blob_id: invalidBlobId, key_epoch: 1, ciphertext_b64: 'unused' },
          { cursor: 2, blob_id: opaqueBlobId('S'), key_epoch: 1, ciphertext_b64: laterCiphertext },
        ] }),
        createSyncTicket: () => Promise.resolve({ ticket: 'ticket-only', expires_in_ms: 1000 }),
        pushUpdate: () => Promise.resolve({ ok: true, cursor: 3, blob_id: 'new', key_epoch: 1, duplicate: false }),
      } as never,
      callbacks: { onUpdateQuarantined },
      socketFactory: () => ({ send() {}, close() {}, onopen: null, onclose: null, onerror: null, onmessage: null }),
    });

    await client.start();

    expect(client.getCursor()).toBe(2);
    expect(client.doc.getMap('notes').get('after-invalid-pulled-id')).toBe('applied');
    expect(loud).toHaveBeenCalledWith('[MatterSyncClient] quarantined remote update with invalid blob id', {
      reason: 'invalid_blob_id', matterHandle, streamHandle, cursor: 1,
    });
    expect(onUpdateQuarantined).toHaveBeenCalledWith({ reason: 'invalid_blob_id' });
    expect(JSON.stringify(loud.mock.calls)).not.toContain(invalidBlobId);
    expect(JSON.stringify(onUpdateQuarantined.mock.calls)).not.toContain(invalidBlobId);
    loud.mockRestore();
    client.stop();
  });

  it('quarantines an invalid live-frame blob ID without surfacing it, then applies the later update', async () => {
    const matterHandle = parseMatterHandle(`mh2_${'U'.repeat(43)}`);
    const streamHandle = parseStreamHandle(`sh2_${'V'.repeat(43)}`);
    const keyB64 = await generateMatterKey();
    const key = await importMatterKey(keyB64);
    const later = new Y.Doc();
    later.getMap('notes').set('after-invalid-live-id', 'applied');
    const laterCiphertext = await (await import('./matterCrypto')).encryptUpdateV2(
      key, Y.encodeStateAsUpdate(later), { matterHandle, streamHandle, keyEpoch: 1 },
    );
    const invalidBlobId = 'CLIENT_SECRET_NIMBUS';
    const loud = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const onUpdateQuarantined = vi.fn();
    let socket: WebSocketLike | undefined;
    const client = new MatterSyncClient({
      matterHandle, streamHandle, keyB64, keyEpoch: 1, seatToken: 'seat',
      client: {
        pullUpdates: () => Promise.resolve({ key_epoch: 1, since: 0, cursor: 0, latest_cursor: 0, has_more: false, updates: [] }),
        createSyncTicket: () => Promise.resolve({ ticket: 'ticket-only', expires_in_ms: 1000 }),
        pushUpdate: () => Promise.resolve({ ok: true, cursor: 3, blob_id: 'new', key_epoch: 1, duplicate: false }),
      } as never,
      callbacks: { onUpdateQuarantined },
      socketFactory: () => {
        socket = { send() {}, close() {}, onopen: null, onclose: null, onerror: null, onmessage: null };
        return socket;
      },
    });

    await client.start();
    socket?.onmessage?.({ data: JSON.stringify({ type: 'ready', backlog: 0, latest_cursor: 0, subscribers: 1 }) });
    socket?.onmessage?.({ data: JSON.stringify({ type: 'update', cursor: 1, blob_id: invalidBlobId, key_epoch: 1, ciphertext_b64: 'unused' }) });
    socket?.onmessage?.({ data: JSON.stringify({ type: 'update', cursor: 2, blob_id: opaqueBlobId('W'), key_epoch: 1, ciphertext_b64: laterCiphertext }) });

    await vi.waitFor(() => {
      expect(client.getCursor()).toBe(2);
      expect(client.doc.getMap('notes').get('after-invalid-live-id')).toBe('applied');
    });
    expect(loud).toHaveBeenCalledWith('[MatterSyncClient] quarantined remote update with invalid blob id', {
      reason: 'invalid_blob_id', matterHandle, streamHandle, cursor: 1,
    });
    expect(onUpdateQuarantined).toHaveBeenCalledWith({ reason: 'invalid_blob_id' });
    expect(JSON.stringify(loud.mock.calls)).not.toContain(invalidBlobId);
    expect(JSON.stringify(onUpdateQuarantined.mock.calls)).not.toContain(invalidBlobId);
    loud.mockRestore();
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
        pushUpdate: (_matter: string, _stream: string, _blob: string, _ciphertext: string, _seat: string, _epoch: number, signal?: AbortSignal) => new Promise((_resolve, reject) => { pushStarted = true; signal?.addEventListener('abort', () => { sawAbort = true; reject(new Error('aborted')); }, { once: true }); }),
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
    await expect(flush).rejects.toThrow('Could not publish the encrypted root update');
    expect(sawAbort).toBe(true);
    client.stop();
  });

  it('pins queued ciphertext to its original epoch across a key rotation', async () => {
    const matterHandle = parseMatterHandle(`mh2_${'I'.repeat(43)}`);
    const streamHandle = parseStreamHandle(`sh2_${'J'.repeat(43)}`);
    const epochOneKey = await generateMatterKey();
    const epochTwoKey = await generateMatterKey();
    const sent: Array<{ ciphertext: string; epoch: number }> = [];
    let attempts = 0;
    const doc = new Y.Doc();
    const client = new MatterSyncClient({
      matterHandle, streamHandle, keyB64: epochOneKey, keyEpoch: 1, seatToken: 'seat', doc,
      client: {
        pullUpdates: () => Promise.resolve({ key_epoch: 1, since: 0, cursor: 0, latest_cursor: 0, has_more: false, updates: [] }),
        createSyncTicket: () => Promise.resolve({ ticket: 'ticket-only', expires_in_ms: 1000 }),
        pushUpdate: (_matter: string, _stream: string, _blob: string, ciphertext: string, _seat: string, epoch: number) => {
          sent.push({ ciphertext, epoch });
          attempts += 1;
          if (attempts === 1) return Promise.reject(new Error('network lost after encryption'));
          return Promise.resolve({ ok: true, cursor: 1, blob_id: 'queued', key_epoch: 2, duplicate: false });
        },
      } as never,
      socketFactory: () => ({ send() {}, close() {}, onopen: null, onclose: null, onerror: null, onmessage: null }),
    });
    await client.start();
    doc.getMap('root').set('queued-before-rotate', true);
    for (let tries = 0; sent.length < 1 && tries < 20; tries += 1) await new Promise((resolve) => setTimeout(resolve, 1));
    await client.rotateKey(epochTwoKey, 2);
    await client.flush();

    expect(sent).toHaveLength(2);
    expect(sent[1]?.epoch).toBe(1);
    expect(sent[1]?.ciphertext).toBe(sent[0]?.ciphertext);
    const retried = sent[1];
    if (!retried) throw new Error('Queued write was not retried.');
    const opened = await decryptUpdateV2(await importMatterKey(epochOneKey), retried.ciphertext, { matterHandle, streamHandle, keyEpoch: 1 });
    expect(opened.ok).toBe(true);
    const rejected = await decryptUpdateV2(await importMatterKey(epochTwoKey), retried.ciphertext, { matterHandle, streamHandle, keyEpoch: 2 });
    expect(rejected.ok).toBe(false);
    client.stop();
  });
});
