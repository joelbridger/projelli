import * as Y from 'yjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseMatterHandle, parseStreamHandle } from './contract';
import {
  addDocumentStreamToPrivateIndex, createDocumentStream, FIRM_PRIVATE_INDEX_MAP, FIRM_PRIVATE_INDEX_STREAMS_V2_MAP,
  observeDocumentStreamsForPinning, readFirmMatterPrivateIndex, tombstoneDocumentStreamFromPrivateIndex, writeFirmMatterPrivateIndex,
} from './firmMatterPrivateIndex';
import { getPinnedDocumentStream } from './firmKeychain';

const retirementGate = vi.hoisted(() => ({
  enabled: false,
  started: undefined as (() => void) | undefined,
  release: undefined as (() => void) | undefined,
}));

vi.mock('./firmKeychain', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./firmKeychain')>();
  return {
    ...actual,
    retirePinnedDocumentStream: async (...args: Parameters<typeof actual.retirePinnedDocumentStream>) => {
      await actual.retirePinnedDocumentStream(...args);
      if (!retirementGate.enabled) return;
      retirementGate.started?.();
      await new Promise<void>((resolve) => { retirementGate.release = resolve; });
    },
  };
});

const matterHandle = parseMatterHandle(`mh2_${'M'.repeat(43)}`);
const root = parseStreamHandle(`sh2_${'R'.repeat(43)}`);
const docStream = parseStreamHandle(`sh2_${'D'.repeat(43)}`);
afterEach(() => {
  retirementGate.enabled = false;
  retirementGate.started = undefined;
  retirementGate.release = undefined;
  localStorage.clear();
});
describe('encrypted FirmMatterPrivateIndex', () => {
  function seedLegacyIndex(doc: Y.Doc, streams: Record<string, { streamHandle: typeof root; kind: 'notes' | 'document' }>) {
    const index = doc.getMap<unknown>(FIRM_PRIVATE_INDEX_MAP);
    index.set('version', 1);
    index.set('clientName', 'x');
    index.set('displayName', 'x');
    index.set('streams', streams);
  }

  it('generates a strict 256-bit client handle and writes its local mapping without a relay round trip', async () => {
    const doc = new Y.Doc();
    writeFirmMatterPrivateIndex(doc, { version: 1, clientName: 'CLIENT_SECRET_NIMBUS', displayName: 'Nimbus', streams: { _notes: { streamHandle: root, kind: 'notes' } } });
    const handle = await createDocumentStream(doc, matterHandle, 'doc-advisory-plan.docx');
    expect(handle).toMatch(/^sh2_[A-Za-z0-9_-]{43}$/);
    expect(parseStreamHandle(handle)).toBe(handle);
    expect(readFirmMatterPrivateIndex(doc)?.streams['doc-advisory-plan.docx']).toEqual({ streamHandle: handle, kind: 'document' });
  });

  it('rejects malformed stream handles rather than treating them as relay routes', () => {
    const doc = new Y.Doc();
    const index = doc.getMap<unknown>('firm-private-index');
    index.set('version', 1); index.set('clientName', 'x'); index.set('displayName', 'x');
    index.set('streams', { x: { streamHandle: 'doc-advisory-plan.docx', kind: 'document' } });
    expect(() => readFirmMatterPrivateIndex(doc)).toThrow();
    expect(parseMatterHandle(`mh2_${'M'.repeat(43)}`)).toBeTruthy();
  });

  it('recovers a locally-written mapping after a crash before its root update is delivered, with no duplicate', async () => {
    const doc = new Y.Doc();
    writeFirmMatterPrivateIndex(doc, { version: 1, clientName: 'x', displayName: 'x', streams: { _notes: { streamHandle: root, kind: 'notes' } } });
    const localHandle = await createDocumentStream(doc, matterHandle, 'crash-before-root-sync.docx');
    const restarted = new Y.Doc();
    Y.applyUpdate(restarted, Y.encodeStateAsUpdate(doc));
    expect(readFirmMatterPrivateIndex(restarted)?.streams['crash-before-root-sync.docx']).toEqual({ streamHandle: localHandle, kind: 'document' });
    expect(Object.values(readFirmMatterPrivateIndex(restarted)?.streams ?? {}).filter((entry) => entry.streamHandle === localHandle)).toHaveLength(1);
  });

  it('merges concurrently added document mappings from two devices', async () => {
    const first = new Y.Doc();
    writeFirmMatterPrivateIndex(first, { version: 1, clientName: 'x', displayName: 'x', streams: { _notes: { streamHandle: root, kind: 'notes' } } });
    const second = new Y.Doc();
    Y.applyUpdate(second, Y.encodeStateAsUpdate(first));
    const firstStream = parseStreamHandle(`sh2_${'A'.repeat(43)}`);
    const secondStream = parseStreamHandle(`sh2_${'B'.repeat(43)}`);

    await addDocumentStreamToPrivateIndex(first, matterHandle, 'first.docx', firstStream);
    await addDocumentStreamToPrivateIndex(second, matterHandle, 'second.docx', secondStream);
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

    await addDocumentStreamToPrivateIndex(first, matterHandle, 'shared.docx', docStream);
    await addDocumentStreamToPrivateIndex(second, matterHandle, 'shared.docx', docStream);
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
    await addDocumentStreamToPrivateIndex(doc, matterHandle, 'first.docx', replacement);

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
    await addDocumentStreamToPrivateIndex(first, matterHandle, 'first.docx', firstStream);
    await addDocumentStreamToPrivateIndex(second, matterHandle, 'second.docx', secondStream);
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
    await addDocumentStreamToPrivateIndex(legacyOnly, matterHandle, 'new.docx', docStream);
    await addDocumentStreamToPrivateIndex(legacyOnly, matterHandle, 'new.docx', docStream);
    expect(readFirmMatterPrivateIndex(legacyOnly)?.streams).toMatchObject({
      _notes: { streamHandle: root, kind: 'notes' },
      'legacy.docx': { streamHandle: docStream, kind: 'document' },
      'new.docx': { streamHandle: docStream, kind: 'document' },
    });
  });

  it('resolves concurrent additions of the same document deterministically', () => {
    const first = new Y.Doc();
    seedLegacyIndex(first, { _notes: { streamHandle: root, kind: 'notes' } });
    const second = new Y.Doc();
    Y.applyUpdate(second, Y.encodeStateAsUpdate(first));
    const firstStream = parseStreamHandle(`sh2_${'G'.repeat(43)}`);
    const secondStream = parseStreamHandle(`sh2_${'H'.repeat(43)}`);

    // Simulate two separate devices writing raw Yjs values concurrently. Their
    // device-local TOFU shelves are intentionally not shared in this test.
    first.getMap<unknown>(FIRM_PRIVATE_INDEX_STREAMS_V2_MAP).set('shared.docx', { streamHandle: firstStream, kind: 'document' });
    second.getMap<unknown>(FIRM_PRIVATE_INDEX_STREAMS_V2_MAP).set('shared.docx', { streamHandle: secondStream, kind: 'document' });
    Y.applyUpdate(first, Y.encodeStateAsUpdate(second));
    Y.applyUpdate(second, Y.encodeStateAsUpdate(first));

    const firstResult = readFirmMatterPrivateIndex(first)?.streams['shared.docx'];
    const secondResult = readFirmMatterPrivateIndex(second)?.streams['shared.docx'];
    expect(firstResult).toEqual(secondResult);
    expect([firstStream, secondStream]).toContain(firstResult?.streamHandle);
  });

  it('retires only the tombstoned document stream pin from this matter', async () => {
    const doc = new Y.Doc();
    const secondStream = parseStreamHandle(`sh2_${'Z'.repeat(43)}`);
    writeFirmMatterPrivateIndex(doc, { version: 1, clientName: 'x', displayName: 'x', streams: { _notes: { streamHandle: root, kind: 'notes' } } });
    await addDocumentStreamToPrivateIndex(doc, matterHandle, 'deleted.docx', docStream);
    await addDocumentStreamToPrivateIndex(doc, matterHandle, 'retained.docx', secondStream);
    expect(await getPinnedDocumentStream(matterHandle, 'deleted.docx')).toBe(docStream);
    expect(await getPinnedDocumentStream(matterHandle, 'retained.docx')).toBe(secondStream);

    await tombstoneDocumentStreamFromPrivateIndex(doc, matterHandle, 'deleted.docx');

    await expect(getPinnedDocumentStream(matterHandle, 'deleted.docx')).rejects.toThrow('retired');
    expect(await getPinnedDocumentStream(matterHandle, 'retained.docx')).toBe(secondStream);
  });

  it('keeps a peer replacement mapping when it arrives during local document deletion', async () => {
    const doc = new Y.Doc();
    const replacementStream = parseStreamHandle(`sh2_${'P'.repeat(43)}`);
    writeFirmMatterPrivateIndex(doc, { version: 1, clientName: 'x', displayName: 'x', streams: { _notes: { streamHandle: root, kind: 'notes' } } });
    await addDocumentStreamToPrivateIndex(doc, matterHandle, 'draft.docx', docStream);

    const peer = new Y.Doc();
    Y.applyUpdate(peer, Y.encodeStateAsUpdate(doc));
    retirementGate.enabled = true;
    const retirementStarted = new Promise<void>((resolve) => { retirementGate.started = resolve; });
    const deletion = tombstoneDocumentStreamFromPrivateIndex(doc, matterHandle, 'draft.docx');
    await retirementStarted;

    peer.getMap<unknown>(FIRM_PRIVATE_INDEX_STREAMS_V2_MAP).set(
      'draft.docx', { streamHandle: replacementStream, kind: 'document' },
    );
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(peer, Y.encodeStateVector(doc)));
    expect(readFirmMatterPrivateIndex(doc)?.streams['draft.docx']).toEqual({ streamHandle: replacementStream, kind: 'document' });

    retirementGate.release?.();
    await expect(deletion).rejects.toThrow('Document deletion was blocked because its encrypted stream mapping changed on this device.');
    expect(readFirmMatterPrivateIndex(doc)?.streams['draft.docx']).toEqual({ streamHandle: replacementStream, kind: 'document' });
  });

  it('blocks tombstoning when the shared mapping changed before this device ever deleted the document', async () => {
    const doc = new Y.Doc();
    const replacementStream = parseStreamHandle(`sh2_${'P'.repeat(43)}`);
    writeFirmMatterPrivateIndex(doc, { version: 1, clientName: 'x', displayName: 'x', streams: { _notes: { streamHandle: root, kind: 'notes' } } });
    await addDocumentStreamToPrivateIndex(doc, matterHandle, 'draft.docx', docStream);

    // A hostile peer rewrites the shared directory BEFORE this device's first
    // (and only) deletion attempt for this document — no crash, no prior
    // retirement, just a straightforward redirection.
    doc.getMap<unknown>(FIRM_PRIVATE_INDEX_STREAMS_V2_MAP).set('draft.docx', { streamHandle: replacementStream, kind: 'document' });

    await expect(tombstoneDocumentStreamFromPrivateIndex(doc, matterHandle, 'draft.docx')).rejects.toThrow('changed on this device');

    // Neither the original pin nor the shared directory entry may be touched.
    expect(await getPinnedDocumentStream(matterHandle, 'draft.docx')).toBe(docStream);
    expect(readFirmMatterPrivateIndex(doc)?.streams['draft.docx']).toEqual({ streamHandle: replacementStream, kind: 'document' });
  });

  it('refuses to trust a replacement shared-directory mapping for a retired local document ID', async () => {
    const doc = new Y.Doc();
    const replacementStream = parseStreamHandle(`sh2_${'Q'.repeat(43)}`);
    writeFirmMatterPrivateIndex(doc, { version: 1, clientName: 'x', displayName: 'x', streams: { _notes: { streamHandle: root, kind: 'notes' } } });
    await addDocumentStreamToPrivateIndex(doc, matterHandle, 'draft.docx', docStream);
    await tombstoneDocumentStreamFromPrivateIndex(doc, matterHandle, 'draft.docx');

    // A hostile peer rewrites the shared directory after the honest delete.
    doc.getMap<unknown>(FIRM_PRIVATE_INDEX_STREAMS_V2_MAP).set('draft.docx', { streamHandle: replacementStream, kind: 'document' });
    await expect(getPinnedDocumentStream(matterHandle, 'draft.docx')).rejects.toThrow('retired');
    await expect(addDocumentStreamToPrivateIndex(doc, matterHandle, 'draft.docx', replacementStream)).rejects.toThrow('retired');
    await expect(observeDocumentStreamsForPinning(doc, matterHandle)).resolves.toEqual([
      { localDocumentId: 'draft.docx', kind: 'retired', observedStreamHandle: replacementStream },
    ]);
    await expect(getPinnedDocumentStream(matterHandle, 'draft.docx')).rejects.toThrow('retired');
  });

  it('gives document creation a clear error when its local document ID was already retired', async () => {
    const doc = new Y.Doc();
    writeFirmMatterPrivateIndex(doc, { version: 1, clientName: 'x', displayName: 'x', streams: { _notes: { streamHandle: root, kind: 'notes' } } });
    await addDocumentStreamToPrivateIndex(doc, matterHandle, 'deleted.docx', docStream);
    await tombstoneDocumentStreamFromPrivateIndex(doc, matterHandle, 'deleted.docx');

    await expect(createDocumentStream(doc, matterHandle, 'deleted.docx'))
      .rejects.toThrow('already used and deleted. Choose a different one');
  });

  it('pins a genuinely new local document ID on its first observation', async () => {
    const doc = new Y.Doc();
    const freshStream = parseStreamHandle(`sh2_${'P'.repeat(43)}`);
    writeFirmMatterPrivateIndex(doc, {
      version: 1,
      clientName: 'x',
      displayName: 'x',
      streams: {
        _notes: { streamHandle: root, kind: 'notes' },
        'new-never-seen-document-id': { streamHandle: freshStream, kind: 'document' },
      },
    });

    await expect(observeDocumentStreamsForPinning(doc, matterHandle)).resolves.toEqual([]);
    expect(await getPinnedDocumentStream(matterHandle, 'new-never-seen-document-id')).toBe(freshStream);
  });
});
