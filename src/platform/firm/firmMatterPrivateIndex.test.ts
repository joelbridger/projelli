import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';
import { parseMatterHandle, parseStreamHandle } from './contract';
import { MatterSyncClient, type WebSocketLike } from './MatterSyncClient';
import { generateMatterKey } from './matterCrypto';
import {
  addDocumentStreamToPrivateIndex, createDocumentStream, FIRM_PRIVATE_INDEX_MAP, FIRM_PRIVATE_INDEX_STREAMS_V2_MAP,
  readFirmMatterPrivateIndex, writeFirmMatterPrivateIndex,
} from './firmMatterPrivateIndex';

const root = parseStreamHandle(`sh2_${'R'.repeat(43)}`);
const docStream = parseStreamHandle(`sh2_${'D'.repeat(43)}`);

function rootSyncClient(
  doc: Y.Doc,
  pushUpdate: (streamHandle: typeof root) => Promise<{ ok: true; cursor: number; blob_id: string; key_epoch: number; duplicate: boolean }>,
): Promise<MatterSyncClient> {
  return generateMatterKey().then((keyB64) => new MatterSyncClient({
    matterHandle: parseMatterHandle(`mh2_${'M'.repeat(43)}`),
    streamHandle: root,
    keyB64,
    keyEpoch: 1,
    seatToken: 'seat-token',
    doc,
    client: {
      pullUpdates: () => Promise.resolve({ key_epoch: 1, since: 0, cursor: 0, latest_cursor: 0, has_more: false, updates: [] }),
      createSyncTicket: () => Promise.resolve({ ticket: 'ticket', expires_in_ms: 1_000 }),
      pushUpdate,
    } as never,
    socketFactory: (): WebSocketLike => ({ send() {}, close() {}, onopen: null, onclose: null, onerror: null, onmessage: null }),
  }));
}

describe('encrypted FirmMatterPrivateIndex', () => {
  function seedLegacyIndex(doc: Y.Doc, streams: Record<string, { streamHandle: typeof root; kind: 'notes' | 'document' }>) {
    const index = doc.getMap<unknown>(FIRM_PRIVATE_INDEX_MAP);
    index.set('version', 1);
    index.set('clientName', 'x');
    index.set('displayName', 'x');
    index.set('streams', streams);
  }

  it('keeps document mappings in a dedicated Yjs root map and waits before document use', async () => {
    const doc = new Y.Doc();
    writeFirmMatterPrivateIndex(doc, { version: 1, clientName: 'CLIENT_SECRET_NIMBUS', displayName: 'Nimbus', streams: { _notes: { streamHandle: root, kind: 'notes' } } });
    let flushed = false;
    await addDocumentStreamToPrivateIndex(doc, { flush: () => { flushed = true; return Promise.resolve(); } }, 'doc-advisory-plan.docx', docStream);
    expect(flushed).toBe(true);
    expect(readFirmMatterPrivateIndex(doc)?.streams['doc-advisory-plan.docx']).toEqual({ streamHandle: docStream, kind: 'document' });
  });

  it('rejects malformed stream handles rather than treating them as relay routes', () => {
    const doc = new Y.Doc();
    const index = doc.getMap<unknown>('firm-private-index');
    index.set('version', 1); index.set('clientName', 'x'); index.set('displayName', 'x');
    index.set('streams', { x: { streamHandle: 'doc-advisory-plan.docx', kind: 'document' } });
    expect(() => readFirmMatterPrivateIndex(doc)).toThrow();
    expect(parseMatterHandle(`mh2_${'M'.repeat(43)}`)).toBeTruthy();
  });

  it('allocates an opaque stream before writing its encrypted local mapping', async () => {
    const doc = new Y.Doc();
    writeFirmMatterPrivateIndex(doc, { version: 1, clientName: 'x', displayName: 'x', streams: { _notes: { streamHandle: root, kind: 'notes' } } });
    const events: string[] = [];
    const result = await createDocumentStream(
      { allocateStream: () => { events.push('allocate'); return Promise.resolve({ stream_handle: docStream }); } } as never,
      parseMatterHandle(`mh2_${'M'.repeat(43)}`), 'seat-token', doc,
      { flush: () => { events.push('encrypted-root-accepted'); return Promise.resolve(); } }, 'local-document-id',
    );
    expect(result).toBe(docStream);
    expect(events).toEqual(['allocate', 'encrypted-root-accepted']);
  });

  it('rejects document-stream creation after a failed root push, removes the local mapping, and leaves the unused lease reclaimable', async () => {
    const doc = new Y.Doc();
    writeFirmMatterPrivateIndex(doc, { version: 1, clientName: 'x', displayName: 'x', streams: { _notes: { streamHandle: root, kind: 'notes' } } });
    const pushedStreams: string[] = [];
    const sync = await rootSyncClient(doc, (streamHandle) => {
      pushedStreams.push(streamHandle);
      return Promise.reject(new Error('relay unavailable'));
    });
    await sync.start();

    await expect(createDocumentStream(
      { allocateStream: () => Promise.resolve({ stream_handle: docStream }) } as never,
      parseMatterHandle(`mh2_${'M'.repeat(43)}`), 'seat-token', doc, sync, 'local-document-id',
    )).rejects.toThrow('Could not publish the encrypted root update.');

    expect(readFirmMatterPrivateIndex(doc)?.streams['local-document-id']).toBeUndefined();
    // Only root-index ciphertext was attempted. The allocated document stream
    // has accepted no data, so the relay's normal idle-lease cleanup can reclaim it.
    expect(pushedStreams).not.toContain(docStream);
    sync.stop();
  });

  it('abandons an allocated stream when its root-index flush outlives the lease commit deadline', async () => {
    const doc = new Y.Doc();
    writeFirmMatterPrivateIndex(doc, { version: 1, clientName: 'x', displayName: 'x', streams: { _notes: { streamHandle: root, kind: 'notes' } } });
    let allocated = false;
    await expect(createDocumentStream(
      { allocateStream: () => { allocated = true; return Promise.resolve({ stream_handle: docStream }); } } as never,
      parseMatterHandle(`mh2_${'M'.repeat(43)}`), 'seat-token', doc,
      { flush: ({ signal } = {}) => new Promise<void>((_resolve, reject) => { signal?.addEventListener('abort', () => { reject(new Error('deadline elapsed')); }, { once: true }); }) },
      'timed-out-document', { leaseCommitDeadlineMs: 5 },
    )).rejects.toThrow('deadline elapsed');

    expect(allocated).toBe(true);
    expect(readFirmMatterPrivateIndex(doc)?.streams['timed-out-document']).toBeUndefined();
  });

  it('retries a transient root push failure and returns the mapped stream only after acceptance', async () => {
    const doc = new Y.Doc();
    writeFirmMatterPrivateIndex(doc, { version: 1, clientName: 'x', displayName: 'x', streams: { _notes: { streamHandle: root, kind: 'notes' } } });
    let attempts = 0;
    const sync = await rootSyncClient(doc, () => {
      attempts += 1;
      if (attempts === 1) return Promise.reject(new Error('temporary relay failure'));
      return Promise.resolve({ ok: true, cursor: attempts, blob_id: `root-${String(attempts)}`, key_epoch: 1, duplicate: false });
    });
    await sync.start();

    await expect(createDocumentStream(
      { allocateStream: () => Promise.resolve({ stream_handle: docStream }) } as never,
      parseMatterHandle(`mh2_${'M'.repeat(43)}`), 'seat-token', doc, sync, 'local-document-id',
    )).resolves.toBe(docStream);

    expect(attempts).toBe(2);
    expect(readFirmMatterPrivateIndex(doc)?.streams['local-document-id']).toEqual({ streamHandle: docStream, kind: 'document' });
    sync.stop();
  });

  it('merges concurrently added document mappings from two devices', async () => {
    const first = new Y.Doc();
    writeFirmMatterPrivateIndex(first, { version: 1, clientName: 'x', displayName: 'x', streams: { _notes: { streamHandle: root, kind: 'notes' } } });
    const second = new Y.Doc();
    Y.applyUpdate(second, Y.encodeStateAsUpdate(first));
    const firstStream = parseStreamHandle(`sh2_${'A'.repeat(43)}`);
    const secondStream = parseStreamHandle(`sh2_${'B'.repeat(43)}`);

    await addDocumentStreamToPrivateIndex(first, { flush: () => Promise.resolve() }, 'first.docx', firstStream);
    await addDocumentStreamToPrivateIndex(second, { flush: () => Promise.resolve() }, 'second.docx', secondStream);
    Y.applyUpdate(first, Y.encodeStateAsUpdate(second));
    Y.applyUpdate(second, Y.encodeStateAsUpdate(first));

    for (const doc of [first, second]) {
      expect(readFirmMatterPrivateIndex(doc)?.streams).toMatchObject({
        'first.docx': { streamHandle: firstStream, kind: 'document' },
        'second.docx': { streamHandle: secondStream, kind: 'document' },
      });
    }
  });

  it('is idempotent and convergent when two devices add the same document', async () => {
    const first = new Y.Doc();
    writeFirmMatterPrivateIndex(first, { version: 1, clientName: 'x', displayName: 'x', streams: { _notes: { streamHandle: root, kind: 'notes' } } });
    const second = new Y.Doc();
    Y.applyUpdate(second, Y.encodeStateAsUpdate(first));

    await addDocumentStreamToPrivateIndex(first, { flush: () => Promise.resolve() }, 'shared.docx', docStream);
    await addDocumentStreamToPrivateIndex(second, { flush: () => Promise.resolve() }, 'shared.docx', docStream);
    Y.applyUpdate(first, Y.encodeStateAsUpdate(second));
    Y.applyUpdate(second, Y.encodeStateAsUpdate(first));
    // Replaying the same encrypted root updates must not change the one mapping.
    Y.applyUpdate(first, Y.encodeStateAsUpdate(second));
    Y.applyUpdate(second, Y.encodeStateAsUpdate(first));

    expect(readFirmMatterPrivateIndex(first)?.streams['shared.docx']).toEqual({ streamHandle: docStream, kind: 'document' });
    expect(readFirmMatterPrivateIndex(second)?.streams['shared.docx']).toEqual({ streamHandle: docStream, kind: 'document' });
  });

  it('reads legacy streams and the versioned directory as one map, with the new directory winning', async () => {
    const doc = new Y.Doc();
    seedLegacyIndex(doc, {
      _notes: { streamHandle: root, kind: 'notes' },
      'first.docx': { streamHandle: docStream, kind: 'document' },
    });
    const replacement = parseStreamHandle(`sh2_${'C'.repeat(43)}`);
    await addDocumentStreamToPrivateIndex(doc, { flush: () => Promise.resolve() }, 'first.docx', replacement);

    expect(readFirmMatterPrivateIndex(doc)?.streams).toEqual({
      _notes: { streamHandle: root, kind: 'notes' },
      'first.docx': { streamHandle: replacement, kind: 'document' },
    });
    expect(doc.getMap<unknown>(FIRM_PRIVATE_INDEX_MAP).get('streams')).not.toBeInstanceOf(Y.Map);
    expect(doc.getMap<unknown>(FIRM_PRIVATE_INDEX_STREAMS_V2_MAP)).toBeInstanceOf(Y.Map);
  });

  it('concurrently upgrades two legacy clients and retains both newly added mappings in both merge directions', async () => {
    const first = new Y.Doc();
    seedLegacyIndex(first, { _notes: { streamHandle: root, kind: 'notes' } });
    const legacyUpdate = Y.encodeStateAsUpdate(first);
    const second = new Y.Doc();
    Y.applyUpdate(second, legacyUpdate);
    const third = new Y.Doc();
    Y.applyUpdate(third, legacyUpdate);
    const firstStream = parseStreamHandle(`sh2_${'E'.repeat(43)}`);
    const secondStream = parseStreamHandle(`sh2_${'F'.repeat(43)}`);

    // Both start with only the old object. The old nested-map migration lost
    // one of these writes because each client assigned a different Y.Map to
    // the same parent key.
    await addDocumentStreamToPrivateIndex(first, { flush: () => Promise.resolve() }, 'first.docx', firstStream);
    await addDocumentStreamToPrivateIndex(second, { flush: () => Promise.resolve() }, 'second.docx', secondStream);
    const firstUpdate = Y.encodeStateAsUpdate(first);
    const secondUpdate = Y.encodeStateAsUpdate(second);
    Y.applyUpdate(first, secondUpdate);
    Y.applyUpdate(second, firstUpdate);
    // This device had only the old object when it came online. Reading after
    // both encrypted updates proves the legacy + v2 union is complete.
    Y.applyUpdate(third, firstUpdate);
    Y.applyUpdate(third, secondUpdate);

    for (const doc of [first, second, third]) {
      expect(readFirmMatterPrivateIndex(doc)?.streams).toMatchObject({
        _notes: { streamHandle: root, kind: 'notes' },
        'first.docx': { streamHandle: firstStream, kind: 'document' },
        'second.docx': { streamHandle: secondStream, kind: 'document' },
      });
    }
  });

  it('keeps a legacy-only client readable and makes a repeated upgrade harmless', async () => {
    const legacyOnly = new Y.Doc();
    seedLegacyIndex(legacyOnly, {
      _notes: { streamHandle: root, kind: 'notes' },
      'legacy.docx': { streamHandle: docStream, kind: 'document' },
    });

    expect(readFirmMatterPrivateIndex(legacyOnly)?.streams).toMatchObject({
      _notes: { streamHandle: root, kind: 'notes' },
      'legacy.docx': { streamHandle: docStream, kind: 'document' },
    });
    await addDocumentStreamToPrivateIndex(legacyOnly, { flush: () => Promise.resolve() }, 'new.docx', docStream);
    await addDocumentStreamToPrivateIndex(legacyOnly, { flush: () => Promise.resolve() }, 'new.docx', docStream);
    expect(readFirmMatterPrivateIndex(legacyOnly)?.streams).toMatchObject({
      _notes: { streamHandle: root, kind: 'notes' },
      'legacy.docx': { streamHandle: docStream, kind: 'document' },
      'new.docx': { streamHandle: docStream, kind: 'document' },
    });
  });

  it('resolves concurrent additions of the same document deterministically', async () => {
    const first = new Y.Doc();
    seedLegacyIndex(first, { _notes: { streamHandle: root, kind: 'notes' } });
    const second = new Y.Doc();
    Y.applyUpdate(second, Y.encodeStateAsUpdate(first));
    const firstStream = parseStreamHandle(`sh2_${'G'.repeat(43)}`);
    const secondStream = parseStreamHandle(`sh2_${'H'.repeat(43)}`);

    await addDocumentStreamToPrivateIndex(first, { flush: () => Promise.resolve() }, 'shared.docx', firstStream);
    await addDocumentStreamToPrivateIndex(second, { flush: () => Promise.resolve() }, 'shared.docx', secondStream);
    Y.applyUpdate(first, Y.encodeStateAsUpdate(second));
    Y.applyUpdate(second, Y.encodeStateAsUpdate(first));

    const firstResult = readFirmMatterPrivateIndex(first)?.streams['shared.docx'];
    const secondResult = readFirmMatterPrivateIndex(second)?.streams['shared.docx'];
    expect(firstResult).toEqual(secondResult);
    expect([firstStream, secondStream]).toContain(firstResult?.streamHandle);
  });
});
