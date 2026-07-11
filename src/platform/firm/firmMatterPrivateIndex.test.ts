import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';
import { parseMatterHandle, parseStreamHandle } from './contract';
import {
  addDocumentStreamToPrivateIndex, createDocumentStream, readFirmMatterPrivateIndex, writeFirmMatterPrivateIndex,
} from './firmMatterPrivateIndex';

const root = parseStreamHandle(`sh2_${'R'.repeat(43)}`);
const docStream = parseStreamHandle(`sh2_${'D'.repeat(43)}`);

describe('encrypted FirmMatterPrivateIndex', () => {
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

  it('migrates the old plain-object streams shape without dropping mappings', () => {
    const doc = new Y.Doc();
    const index = doc.getMap<unknown>('firm-private-index');
    index.set('version', 1);
    index.set('clientName', 'x');
    index.set('displayName', 'x');
    index.set('streams', {
      _notes: { streamHandle: root, kind: 'notes' },
      'first.docx': { streamHandle: docStream, kind: 'document' },
    });

    expect(readFirmMatterPrivateIndex(doc)?.streams).toEqual({
      _notes: { streamHandle: root, kind: 'notes' },
      'first.docx': { streamHandle: docStream, kind: 'document' },
    });
    expect(doc.getMap<unknown>('firm-private-index').get('streams')).toBeInstanceOf(Y.Map);
  });
});
