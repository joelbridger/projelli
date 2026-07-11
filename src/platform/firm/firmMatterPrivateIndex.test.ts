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
    await addDocumentStreamToPrivateIndex(doc, { flush: async () => { flushed = true; } }, 'doc-advisory-plan.docx', docStream);
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
      { allocateStream: async () => { events.push('allocate'); return { stream_handle: docStream }; } } as never,
      parseMatterHandle(`mh2_${'M'.repeat(43)}`), doc,
      { flush: async () => { events.push('encrypted-root-accepted'); } }, 'local-document-id',
    );
    expect(result).toBe(docStream);
    expect(events).toEqual(['allocate', 'encrypted-root-accepted']);
  });
});
