import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';
import { parseMatterHandle, parseStreamHandle } from './contract';
import {
  addDocumentStreamToPrivateIndex, createDocumentStream, FIRM_PRIVATE_INDEX_MAP, FIRM_PRIVATE_INDEX_STREAMS_V2_MAP,
  readFirmMatterPrivateIndex, writeFirmMatterPrivateIndex,
} from './firmMatterPrivateIndex';

const root = parseStreamHandle(`sh2_${'R'.repeat(43)}`);
const docStream = parseStreamHandle(`sh2_${'D'.repeat(43)}`);
describe('encrypted FirmMatterPrivateIndex', () => {
  function seedLegacyIndex(doc: Y.Doc, streams: Record<string, { streamHandle: typeof root; kind: 'notes' | 'document' }>) {
    const index = doc.getMap<unknown>(FIRM_PRIVATE_INDEX_MAP);
    index.set('version', 1);
    index.set('clientName', 'x');
    index.set('displayName', 'x');
    index.set('streams', streams);
  }

  it('generates a strict 256-bit client handle and writes its local mapping without a relay round trip', () => {
    const doc = new Y.Doc();
    writeFirmMatterPrivateIndex(doc, { version: 1, clientName: 'CLIENT_SECRET_NIMBUS', displayName: 'Nimbus', streams: { _notes: { streamHandle: root, kind: 'notes' } } });
    const handle = createDocumentStream(doc, 'doc-advisory-plan.docx');
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

  it('recovers a locally-written mapping after a crash before its root update is delivered, with no duplicate', () => {
    const doc = new Y.Doc();
    writeFirmMatterPrivateIndex(doc, { version: 1, clientName: 'x', displayName: 'x', streams: { _notes: { streamHandle: root, kind: 'notes' } } });
    const localHandle = createDocumentStream(doc, 'crash-before-root-sync.docx');
    const restarted = new Y.Doc();
    Y.applyUpdate(restarted, Y.encodeStateAsUpdate(doc));
    expect(readFirmMatterPrivateIndex(restarted)?.streams['crash-before-root-sync.docx']).toEqual({ streamHandle: localHandle, kind: 'document' });
    expect(Object.values(readFirmMatterPrivateIndex(restarted)?.streams ?? {}).filter((entry) => entry.streamHandle === localHandle)).toHaveLength(1);
  });

  it('merges concurrently added document mappings from two devices', () => {
    const first = new Y.Doc();
    writeFirmMatterPrivateIndex(first, { version: 1, clientName: 'x', displayName: 'x', streams: { _notes: { streamHandle: root, kind: 'notes' } } });
    const second = new Y.Doc();
    Y.applyUpdate(second, Y.encodeStateAsUpdate(first));
    const firstStream = parseStreamHandle(`sh2_${'A'.repeat(43)}`);
    const secondStream = parseStreamHandle(`sh2_${'B'.repeat(43)}`);

    addDocumentStreamToPrivateIndex(first, 'first.docx', firstStream);
    addDocumentStreamToPrivateIndex(second, 'second.docx', secondStream);
    Y.applyUpdate(first, Y.encodeStateAsUpdate(second));
    Y.applyUpdate(second, Y.encodeStateAsUpdate(first));

    for (const doc of [first, second]) {
      expect(readFirmMatterPrivateIndex(doc)?.streams).toMatchObject({
        'first.docx': { streamHandle: firstStream, kind: 'document' },
        'second.docx': { streamHandle: secondStream, kind: 'document' },
      });
    }
  });

  it('is idempotent and convergent when two devices add the same document', () => {
    const first = new Y.Doc();
    writeFirmMatterPrivateIndex(first, { version: 1, clientName: 'x', displayName: 'x', streams: { _notes: { streamHandle: root, kind: 'notes' } } });
    const second = new Y.Doc();
    Y.applyUpdate(second, Y.encodeStateAsUpdate(first));

    addDocumentStreamToPrivateIndex(first, 'shared.docx', docStream);
    addDocumentStreamToPrivateIndex(second, 'shared.docx', docStream);
    Y.applyUpdate(first, Y.encodeStateAsUpdate(second));
    Y.applyUpdate(second, Y.encodeStateAsUpdate(first));
    // Replaying the same encrypted root updates must not change the one mapping.
    Y.applyUpdate(first, Y.encodeStateAsUpdate(second));
    Y.applyUpdate(second, Y.encodeStateAsUpdate(first));

    expect(readFirmMatterPrivateIndex(first)?.streams['shared.docx']).toEqual({ streamHandle: docStream, kind: 'document' });
    expect(readFirmMatterPrivateIndex(second)?.streams['shared.docx']).toEqual({ streamHandle: docStream, kind: 'document' });
  });

  it('reads legacy streams and the versioned directory as one map, with the new directory winning', () => {
    const doc = new Y.Doc();
    seedLegacyIndex(doc, {
      _notes: { streamHandle: root, kind: 'notes' },
      'first.docx': { streamHandle: docStream, kind: 'document' },
    });
    const replacement = parseStreamHandle(`sh2_${'C'.repeat(43)}`);
    addDocumentStreamToPrivateIndex(doc, 'first.docx', replacement);

    expect(readFirmMatterPrivateIndex(doc)?.streams).toEqual({
      _notes: { streamHandle: root, kind: 'notes' },
      'first.docx': { streamHandle: replacement, kind: 'document' },
    });
    expect(doc.getMap<unknown>(FIRM_PRIVATE_INDEX_MAP).get('streams')).not.toBeInstanceOf(Y.Map);
    expect(doc.getMap<unknown>(FIRM_PRIVATE_INDEX_STREAMS_V2_MAP)).toBeInstanceOf(Y.Map);
  });

  it('concurrently upgrades two legacy clients and retains both newly added mappings in both merge directions', () => {
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
    addDocumentStreamToPrivateIndex(first, 'first.docx', firstStream);
    addDocumentStreamToPrivateIndex(second, 'second.docx', secondStream);
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

  it('keeps a legacy-only client readable and makes a repeated upgrade harmless', () => {
    const legacyOnly = new Y.Doc();
    seedLegacyIndex(legacyOnly, {
      _notes: { streamHandle: root, kind: 'notes' },
      'legacy.docx': { streamHandle: docStream, kind: 'document' },
    });

    expect(readFirmMatterPrivateIndex(legacyOnly)?.streams).toMatchObject({
      _notes: { streamHandle: root, kind: 'notes' },
      'legacy.docx': { streamHandle: docStream, kind: 'document' },
    });
    addDocumentStreamToPrivateIndex(legacyOnly, 'new.docx', docStream);
    addDocumentStreamToPrivateIndex(legacyOnly, 'new.docx', docStream);
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

    addDocumentStreamToPrivateIndex(first, 'shared.docx', firstStream);
    addDocumentStreamToPrivateIndex(second, 'shared.docx', secondStream);
    Y.applyUpdate(first, Y.encodeStateAsUpdate(second));
    Y.applyUpdate(second, Y.encodeStateAsUpdate(first));

    const firstResult = readFirmMatterPrivateIndex(first)?.streams['shared.docx'];
    const secondResult = readFirmMatterPrivateIndex(second)?.streams['shared.docx'];
    expect(firstResult).toEqual(secondResult);
    expect([firstStream, secondStream]).toContain(firstResult?.streamHandle);
  });
});
