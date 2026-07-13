import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import * as matterCrypto from './matterCrypto';
import { MatterSyncClient, type WebSocketLike } from './MatterSyncClient';
import { decryptUpdateV2, generateMatterKey, importMatterKey } from './matterCrypto';
import { parseMatterHandle, parseStreamHandle } from './contract';

const opaqueBlobId = (character: string): string => `bh2_${character.repeat(43)}`;

describe('MatterSyncClient v2 socket privacy', () => {
  it('does not resume a stopped start after key import settles', async () => {
    const keyB64 = await generateMatterKey();
    const key = await importMatterKey(keyB64);
    let releaseKey: ((value: CryptoKey) => void) | undefined;
    const keyImport = new Promise<CryptoKey>((resolve) => {
      releaseKey = resolve;
    });
    const importKey = vi.spyOn(matterCrypto, 'importMatterKey').mockImplementation(() => keyImport);
    const pullUpdates = vi.fn();
    const pushUpdate = vi.fn();
    const socketFactory = vi.fn();
    const client = new MatterSyncClient({
      matterHandle: parseMatterHandle(`mh2_${'Z'.repeat(43)}`), streamHandle: parseStreamHandle(`sh2_${'Y'.repeat(43)}`),
      keyB64, keyEpoch: 1, seatToken: 'seat',
      client: {
        pullUpdates,
        createSyncTicket: () => Promise.resolve({ ticket: 'ticket-only', expires_in_ms: 1000 }),
        pushUpdate,
      } as never,
      socketFactory,
    });

    const starting = client.start();
    await vi.waitFor(() => {
      expect(importKey).toHaveBeenCalledOnce();
    });
    client.stop();
    if (!releaseKey) throw new Error('Key import gate was not initialized.');
    releaseKey(key);
    await starting;

    expect(pullUpdates).not.toHaveBeenCalled();
    expect(socketFactory).not.toHaveBeenCalled();
    client.doc.getMap('notes').set('edit-after-stop', true);
    await Promise.resolve();
    expect(pushUpdate).not.toHaveBeenCalled();
    importKey.mockRestore();
  });

  it('does not apply a live frame queued behind a stopped decrypt', async () => {
    const matterHandle = parseMatterHandle(`mh2_${'Q'.repeat(43)}`);
    const streamHandle = parseStreamHandle(`sh2_${'R'.repeat(43)}`);
    const keyB64 = await generateMatterKey();
    const key = await importMatterKey(keyB64);
    const firstSource = new Y.Doc();
    firstSource.getMap('notes').set('first-frame', true);
    const secondSource = new Y.Doc();
    secondSource.getMap('notes').set('second-frame', true);
    const firstCiphertext = await matterCrypto.encryptUpdateV2(key, Y.encodeStateAsUpdate(firstSource), { matterHandle, streamHandle, keyEpoch: 1 });
    const secondCiphertext = await matterCrypto.encryptUpdateV2(key, Y.encodeStateAsUpdate(secondSource), { matterHandle, streamHandle, keyEpoch: 1 });
    let releaseFirstDecrypt: (() => void) | undefined;
    const firstDecrypt = new Promise<void>((resolve) => { releaseFirstDecrypt = resolve; });
    const realDecrypt = matterCrypto.decryptUpdateV2;
    const decrypt = vi.spyOn(matterCrypto, 'decryptUpdateV2');
    let decryptCalls = 0;
    decrypt.mockImplementation(async (...args) => {
      decryptCalls += 1;
      if (decryptCalls === 1) await firstDecrypt;
      return realDecrypt(...args);
    });
    const pullUpdates = vi.fn(() => Promise.resolve({ key_epoch: 1, since: 0, cursor: 0, latest_cursor: 0, has_more: false, updates: [] }));
    let socket: WebSocketLike | undefined;
    const client = new MatterSyncClient({
      matterHandle, streamHandle, keyB64, keyEpoch: 1, seatToken: 'seat',
      client: {
        pullUpdates,
        createSyncTicket: () => Promise.resolve({ ticket: 'ticket-only', expires_in_ms: 1000 }),
        pushUpdate: () => Promise.resolve({ ok: true, cursor: 3, blob_id: 'new', key_epoch: 1, duplicate: false }),
      } as never,
      socketFactory: () => {
        socket = { send() {}, close() {}, onopen: null, onclose: null, onerror: null, onmessage: null };
        return socket;
      },
    });

    await client.start();
    socket?.onmessage?.({ data: JSON.stringify({ type: 'update', cursor: 1, blob_id: opaqueBlobId('A'), key_epoch: 1, ciphertext_b64: firstCiphertext }) });
    await vi.waitFor(() => { expect(decrypt).toHaveBeenCalledOnce(); });
    socket?.onmessage?.({ data: JSON.stringify({ type: 'update', cursor: 2, blob_id: opaqueBlobId('B'), key_epoch: 1, ciphertext_b64: secondCiphertext }) });
    client.stop();
    if (!releaseFirstDecrypt) throw new Error('First decrypt gate was not initialized.');
    releaseFirstDecrypt();
    await Promise.resolve();
    await Promise.resolve();

    expect(client.doc.getMap('notes').get('first-frame')).toBeUndefined();
    expect(client.doc.getMap('notes').get('second-frame')).toBeUndefined();
    expect(decrypt).toHaveBeenCalledOnce();
    expect(pullUpdates).toHaveBeenCalledOnce();
    decrypt.mockRestore();
  });

  it('does not commit a key rotation or make another relay call after stop during its key import', async () => {
    const currentKeyB64 = await generateMatterKey();
    const nextKeyB64 = await generateMatterKey();
    const nextCryptoKey = await importMatterKey(nextKeyB64);
    let releaseRotationImport: ((value: CryptoKey) => void) | undefined;
    const rotationImport = new Promise<CryptoKey>((resolve) => { releaseRotationImport = resolve; });
    const realImportKey = matterCrypto.importMatterKey;
    const importKey = vi.spyOn(matterCrypto, 'importMatterKey');
    importKey.mockImplementation((keyB64) => keyB64 === nextKeyB64 ? rotationImport : realImportKey(keyB64));
    const pullUpdates = vi.fn(() => Promise.resolve({ key_epoch: 1, since: 0, cursor: 0, latest_cursor: 0, has_more: false, updates: [] }));
    const client = new MatterSyncClient({
      matterHandle: parseMatterHandle(`mh2_${'S'.repeat(43)}`), streamHandle: parseStreamHandle(`sh2_${'T'.repeat(43)}`),
      keyB64: currentKeyB64, keyEpoch: 1, seatToken: 'seat',
      client: {
        pullUpdates,
        createSyncTicket: () => Promise.resolve({ ticket: 'ticket-only', expires_in_ms: 1000 }),
        pushUpdate: () => Promise.resolve({ ok: true, cursor: 1, blob_id: 'new', key_epoch: 1, duplicate: false }),
      } as never,
      socketFactory: () => ({ send() {}, close() {}, onopen: null, onclose: null, onerror: null, onmessage: null }),
    });

    await client.start();
    const rotating = client.rotateKey(nextKeyB64, 2);
    await vi.waitFor(() => { expect(importKey).toHaveBeenCalledWith(nextKeyB64); });
    client.stop();
    if (!releaseRotationImport) throw new Error('Rotation import gate was not initialized.');
    releaseRotationImport(nextCryptoKey);
    await rotating;

    expect(client.getKeyEpoch()).toBe(1);
    expect(pullUpdates).toHaveBeenCalledOnce();
    importKey.mockRestore();
  });

  it('does not begin a rotation that was queued before stop', async () => {
    const currentKeyB64 = await generateMatterKey();
    const importKey = vi.spyOn(matterCrypto, 'importMatterKey');
    const client = new MatterSyncClient({
      matterHandle: parseMatterHandle(`mh2_${'W'.repeat(43)}`), streamHandle: parseStreamHandle(`sh2_${'X'.repeat(43)}`),
      keyB64: currentKeyB64, keyEpoch: 1, seatToken: 'seat',
      client: {
        pullUpdates: vi.fn(),
        createSyncTicket: vi.fn(),
        pushUpdate: vi.fn(),
      } as never,
    });

    const rotating = client.rotateKey(await generateMatterKey(), 2);
    client.stop();
    await rotating;

    expect(client.getKeyEpoch()).toBe(1);
    expect(importKey).not.toHaveBeenCalled();
    importKey.mockRestore();
  });

  it('aborts an in-flight local push on stop and ignores its later acknowledgement', async () => {
    const doc = new Y.Doc();
    let resolvePush: ((value: { ok: true; cursor: number; blob_id: string; key_epoch: number; duplicate: boolean }) => void) | undefined;
    let sawAbort = false;
    const onKeyEpochAdvanced = vi.fn();
    const client = new MatterSyncClient({
      matterHandle: parseMatterHandle(`mh2_${'U'.repeat(43)}`), streamHandle: parseStreamHandle(`sh2_${'V'.repeat(43)}`),
      keyB64: await generateMatterKey(), keyEpoch: 1, seatToken: 'seat', doc,
      client: {
        pullUpdates: () => Promise.resolve({ key_epoch: 1, since: 0, cursor: 0, latest_cursor: 0, has_more: false, updates: [] }),
        createSyncTicket: () => Promise.resolve({ ticket: 'ticket-only', expires_in_ms: 1000 }),
        pushUpdate: (_matter: string, _stream: string, _blob: string, _ciphertext: string, _seat: string, _epoch: number, signal?: AbortSignal) => new Promise((resolve) => {
          resolvePush = resolve;
          signal?.addEventListener('abort', () => { sawAbort = true; }, { once: true });
        }),
      } as never,
      callbacks: { onKeyEpochAdvanced },
      socketFactory: () => ({ send() {}, close() {}, onopen: null, onclose: null, onerror: null, onmessage: null }),
    });

    await client.start();
    doc.getMap('notes').set('local-edit', true);
    await vi.waitFor(() => { expect(resolvePush).toBeDefined(); });
    client.stop();
    expect(sawAbort).toBe(true);
    if (!resolvePush) throw new Error('Push gate was not initialized.');
    resolvePush({ ok: true, cursor: 1, blob_id: 'late', key_epoch: 2, duplicate: false });
    await Promise.resolve();
    await Promise.resolve();

    expect(onKeyEpochAdvanced).not.toHaveBeenCalled();
  });

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

  it('ignores malformed relay presence counts without notifying the UI', async () => {
    let socket: WebSocketLike | undefined;
    const onPresenceCount = vi.fn();
    const client = new MatterSyncClient({
      matterHandle: parseMatterHandle(`mh2_${'P'.repeat(43)}`), streamHandle: parseStreamHandle(`sh2_${'Q'.repeat(43)}`),
      keyB64: await generateMatterKey(), keyEpoch: 1, seatToken: 'seat',
      client: {
        pullUpdates: () => Promise.resolve({ key_epoch: 1, since: 0, cursor: 0, latest_cursor: 0, has_more: false, updates: [] }),
        createSyncTicket: () => Promise.resolve({ ticket: 'ticket-only', expires_in_ms: 1000 }),
        pushUpdate: () => Promise.resolve({ ok: true, cursor: 1, blob_id: 'new', key_epoch: 1, duplicate: false }),
      } as never,
      callbacks: { onPresenceCount },
      socketFactory: () => {
        socket = { send() {}, close() {}, onopen: null, onclose: null, onerror: null, onmessage: null };
        return socket;
      },
    });

    await client.start();
    socket?.onmessage?.({ data: JSON.stringify({ type: 'ready', backlog: 0, latest_cursor: 0, subscribers: 2 }) });
    await vi.waitFor(() => {
      expect(client.getPresenceCount()).toBe(2);
    });
    expect(onPresenceCount).toHaveBeenCalledTimes(1);

    socket?.onmessage?.({ data: JSON.stringify({ type: 'ready', backlog: 0, latest_cursor: 0, subscribers: 'two' }) });
    socket?.onmessage?.({ data: JSON.stringify({ type: 'ready', backlog: 0, latest_cursor: 0, subscribers: -1 }) });
    await Promise.resolve();
    await Promise.resolve();
    expect(client.getPresenceCount()).toBe(2);
    expect(onPresenceCount).toHaveBeenCalledTimes(1);

    socket?.onmessage?.({ data: JSON.stringify({ type: 'presence', count: 'three' }) });
    socket?.onmessage?.({ data: JSON.stringify({ type: 'presence', count: -1 }) });
    await Promise.resolve();
    expect(client.getPresenceCount()).toBe(2);
    expect(onPresenceCount).toHaveBeenCalledTimes(1);
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

  it('rejects an oversized pulled ciphertext before decrypting and still applies the next update', async () => {
    const matterHandle = parseMatterHandle(`mh2_${'T'.repeat(43)}`);
    const streamHandle = parseStreamHandle(`sh2_${'U'.repeat(43)}`);
    const keyB64 = await generateMatterKey();
    const key = await importMatterKey(keyB64);
    const later = new Y.Doc();
    later.getMap('notes').set('after-oversized-pulled-update', 'applied');
    const laterCiphertext = await matterCrypto.encryptUpdateV2(
      key, Y.encodeStateAsUpdate(later), { matterHandle, streamHandle, keyEpoch: 1 },
    );
    const decrypt = vi.spyOn(matterCrypto, 'decryptUpdateV2');
    const onUpdateQuarantined = vi.fn();
    // A boundary-length canonical base64 string with zero padding decodes to
    // 2 bytes over the 1 MiB limit — the exact case round FF caught.
    const oversized = 'A'.repeat(1_398_104);
    const client = new MatterSyncClient({
      matterHandle, streamHandle, keyB64, keyEpoch: 1, seatToken: 'seat',
      client: {
        pullUpdates: () => Promise.resolve({ key_epoch: 1, since: 0, cursor: 2, latest_cursor: 2, has_more: false, updates: [
          { cursor: 1, blob_id: opaqueBlobId('V'), key_epoch: 1, ciphertext_b64: oversized },
          { cursor: 2, blob_id: opaqueBlobId('W'), key_epoch: 1, ciphertext_b64: laterCiphertext },
        ] }),
        createSyncTicket: () => Promise.resolve({ ticket: 'ticket-only', expires_in_ms: 1000 }),
        pushUpdate: () => Promise.resolve({ ok: true, cursor: 3, blob_id: 'new', key_epoch: 1, duplicate: false }),
      } as never,
      callbacks: { onUpdateQuarantined },
      socketFactory: () => ({ send() {}, close() {}, onopen: null, onclose: null, onerror: null, onmessage: null }),
    });

    await client.start();

    expect(client.getCursor()).toBe(2);
    expect(client.doc.getMap('notes').get('after-oversized-pulled-update')).toBe('applied');
    expect(onUpdateQuarantined).toHaveBeenCalledWith({ reason: 'ciphertext_too_large', blobId: opaqueBlobId('V') });
    // Only the following valid entry is ever decrypted — the oversized one never is.
    expect(decrypt).toHaveBeenCalledTimes(1);
    expect(decrypt).not.toHaveBeenCalledWith(expect.anything(), oversized, expect.anything());
    decrypt.mockRestore();
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

  it('quarantines an invalid live cursor without exposing or advancing to it', async () => {
    const matterHandle = parseMatterHandle(`mh2_${'I'.repeat(43)}`);
    const streamHandle = parseStreamHandle(`sh2_${'J'.repeat(43)}`);
    const rawCursor = 'CLIENT_SECRET_NIMBUS';
    const loud = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const onUpdateQuarantined = vi.fn();
    let socket: WebSocketLike | undefined;
    const client = new MatterSyncClient({
      matterHandle, streamHandle, keyB64: await generateMatterKey(), keyEpoch: 1, seatToken: 'seat',
      client: {
        pullUpdates: () => Promise.resolve({ key_epoch: 1, since: 0, cursor: 0, latest_cursor: 0, has_more: false, updates: [] }),
        createSyncTicket: () => Promise.resolve({ ticket: 'ticket-only', expires_in_ms: 1000 }),
        pushUpdate: () => Promise.resolve({ ok: true, cursor: 1, blob_id: 'new', key_epoch: 1, duplicate: false }),
      } as never,
      callbacks: { onUpdateQuarantined },
      socketFactory: () => {
        socket = { send() {}, close() {}, onopen: null, onclose: null, onerror: null, onmessage: null };
        return socket;
      },
    });

    await client.start();
    socket?.onmessage?.({ data: JSON.stringify({ type: 'ready', backlog: 0, latest_cursor: 0, subscribers: 1 }) });
    socket?.onmessage?.({ data: JSON.stringify({ type: 'update', cursor: rawCursor, blob_id: 'also-invalid', key_epoch: 1, ciphertext_b64: 'unused' }) });

    await vi.waitFor(() => {
      expect(loud).toHaveBeenCalledWith('[MatterSyncClient] quarantined remote update with invalid cursor', {
        reason: 'invalid_cursor', matterHandle, streamHandle, cursor: '[invalid relay cursor]',
      });
    });
    expect(client.getCursor()).toBe(0);
    expect(onUpdateQuarantined).toHaveBeenCalledWith({ reason: 'invalid_cursor' });
    expect(JSON.stringify(loud.mock.calls)).not.toContain(rawCursor);
    expect(JSON.stringify(onUpdateQuarantined.mock.calls)).not.toContain(rawCursor);
    loud.mockRestore();
    client.stop();
  });

  it('rejects an oversized live ciphertext before decrypting and still applies the next frame', async () => {
    const matterHandle = parseMatterHandle(`mh2_${'K'.repeat(43)}`);
    const streamHandle = parseStreamHandle(`sh2_${'L'.repeat(43)}`);
    const keyB64 = await generateMatterKey();
    const key = await importMatterKey(keyB64);
    const later = new Y.Doc();
    later.getMap('notes').set('after-oversized-live-frame', 'applied');
    const laterCiphertext = await matterCrypto.encryptUpdateV2(
      key, Y.encodeStateAsUpdate(later), { matterHandle, streamHandle, keyEpoch: 1 },
    );
    const decrypt = vi.spyOn(matterCrypto, 'decryptUpdateV2');
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
    socket?.onmessage?.({ data: JSON.stringify({
      type: 'update', cursor: 1, blob_id: opaqueBlobId('M'), key_epoch: 1,
      ciphertext_b64: 'A'.repeat((4 * Math.ceil((1024 * 1024) / 3)) + 1),
    }) });

    await vi.waitFor(() => {
      expect(onUpdateQuarantined).toHaveBeenCalledWith({ reason: 'ciphertext_too_large', blobId: opaqueBlobId('M') });
    });
    expect(decrypt).not.toHaveBeenCalled();
    expect(client.getCursor()).toBe(1);

    socket?.onmessage?.({ data: JSON.stringify({ type: 'update', cursor: 2, blob_id: opaqueBlobId('N'), key_epoch: 1, ciphertext_b64: laterCiphertext }) });
    await vi.waitFor(() => {
      expect(client.getCursor()).toBe(2);
      expect(client.doc.getMap('notes').get('after-oversized-live-frame')).toBe('applied');
    });
    decrypt.mockRestore();
    client.stop();
  });

  it('does not wrongly quarantine a small valid ciphertext padded with whitespace', async () => {
    // atob() (the eventual decoder) ignores ASCII whitespace, so a hostile
    // relay could otherwise pad a legitimate small update with enough spaces
    // to make the raw-length estimate look oversized and get it skipped.
    const matterHandle = parseMatterHandle(`mh2_${'X'.repeat(43)}`);
    const streamHandle = parseStreamHandle(`sh2_${'Y'.repeat(43)}`);
    const keyB64 = await generateMatterKey();
    const key = await importMatterKey(keyB64);
    const doc = new Y.Doc();
    doc.getMap('notes').set('padded-with-whitespace', 'applied');
    const validCiphertext = await matterCrypto.encryptUpdateV2(
      key, Y.encodeStateAsUpdate(doc), { matterHandle, streamHandle, keyEpoch: 1 },
    );
    const padded = `${validCiphertext}${' '.repeat(1_398_104)}`;
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
    socket?.onmessage?.({ data: JSON.stringify({
      type: 'update', cursor: 1, blob_id: opaqueBlobId('P'), key_epoch: 1, ciphertext_b64: padded,
    }) });

    await vi.waitFor(() => {
      expect(client.getCursor()).toBe(1);
      expect(client.doc.getMap('notes').get('padded-with-whitespace')).toBe('applied');
    });
    expect(onUpdateQuarantined).not.toHaveBeenCalled();
    client.stop();
  });

  it('rejects a live frame padded past the raw-length ceiling before counting whitespace', async () => {
    // Ignoring whitespace for the SIZE ESTIMATE must not mean tolerating an
    // unbounded amount of it — building the whitespace match array (or even
    // just holding the string) over hundreds of megabytes of padding is
    // itself a memory/CPU exhaustion vector, so a raw-length ceiling must
    // reject grossly oversized frames before any whitespace counting runs.
    const matterHandle = parseMatterHandle(`mh2_${'Z'.repeat(43)}`);
    const streamHandle = parseStreamHandle(`sh2_${'0'.repeat(43)}`);
    const keyB64 = await generateMatterKey();
    const key = await importMatterKey(keyB64);
    const validCiphertext = await matterCrypto.encryptUpdateV2(
      key, Y.encodeStateAsUpdate(new Y.Doc()), { matterHandle, streamHandle, keyEpoch: 1 },
    );
    // Comfortably past MAX_RAW_CIPHERTEXT_CHARS (2x the max legitimate
    // ciphertext length), well beyond any incidental whitespace tolerance.
    const grosslyPadded = `${validCiphertext}${' '.repeat(3_000_000)}`;
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
    socket?.onmessage?.({ data: JSON.stringify({
      type: 'update', cursor: 1, blob_id: opaqueBlobId('Q'), key_epoch: 1, ciphertext_b64: grosslyPadded,
    }) });

    await vi.waitFor(() => {
      expect(onUpdateQuarantined).toHaveBeenCalledWith({ reason: 'ciphertext_too_large', blobId: opaqueBlobId('Q') });
    });
    client.stop();
  });

  it('does not wrongly quarantine a canonical ciphertext exactly at the 1 MiB limit with real `==` padding', async () => {
    // A byte count of exactly MAX_UPDATE_BYTES (1,048,576) needs 2 trailing
    // `=` padding characters in its canonical base64 (1,048,576 % 3 === 1).
    // Ignoring that padding overestimates the decoded size by 2 bytes and
    // would wrongly reject a legitimate, maximum-size, relay-accepted update.
    const matterHandle = parseMatterHandle(`mh2_${'1'.repeat(43)}`);
    const streamHandle = parseStreamHandle(`sh2_${'2'.repeat(43)}`);
    const keyB64 = await generateMatterKey();
    // Shape-only: exceedsUpdateByteLimit never validates decodability, only
    // size — this proves the size estimate is correct independent of whether
    // decryption itself later succeeds or fails.
    const atLimitCanonical = `${'A'.repeat(1_398_104 - 2)}==`;
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
    socket?.onmessage?.({ data: JSON.stringify({
      type: 'update', cursor: 1, blob_id: opaqueBlobId('R'), key_epoch: 1, ciphertext_b64: atLimitCanonical,
    }) });

    // Not real ciphertext, so it correctly fails decryption — the point is
    // it must NEVER be classified as too large first.
    await vi.waitFor(() => {
      expect(onUpdateQuarantined).toHaveBeenCalledWith({ reason: 'decrypt_failed', blobId: opaqueBlobId('R') });
    });
    expect(onUpdateQuarantined).not.toHaveBeenCalledWith({ reason: 'ciphertext_too_large', blobId: opaqueBlobId('R') });
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
