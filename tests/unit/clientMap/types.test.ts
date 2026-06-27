// tests/unit/clientMap/types.test.ts
import { describe, it, expect } from 'vitest';
import {
  sourceRefFromRagHit,
  emptyClientMap,
  CORE_SECTION_ORDER,
} from '@/platform/clientMap/types';
import type { RagHit } from '@/platform/utils/tauri-commands';

describe('clientMap/types', () => {
  it('maps a document RagHit to a SourceRef', () => {
    const hit: RagHit = {
      path: '/Clients/Acme/complaint.docx',
      chunkText: 'Acme alleges breach of contract.',
      score: 0.91,
      paragraphIndex: 3,
      id: 'chunk-abc',
      sourceId: '/Clients/Acme/complaint.docx',
      sourceType: 'docx',
      matterId: 'm1',
    };
    const ref = sourceRefFromRagHit(hit);
    expect(ref.kind).toBe('document');
    expect(ref.ref).toBe('/Clients/Acme/complaint.docx');
    expect(ref.snippet).toBe('Acme alleges breach of contract.');
    expect(ref.citationId).toBe('chunk-abc');
  });

  it('maps a mail RagHit to an email SourceRef', () => {
    const hit: RagHit = {
      path: 'Inbox/RE: settlement',
      chunkText: 'They offered 50k.',
      score: 0.8,
      paragraphIndex: 0,
      sourceId: 'mail:msg-123',
      sourceType: 'mail',
    };
    const ref = sourceRefFromRagHit(hit);
    expect(ref.kind).toBe('email');
    expect(ref.ref).toBe('mail:msg-123');
  });

  it('maps additive connector RagHits to connector SourceRefs', () => {
    const base: RagHit = {
      path: 'connector-source',
      chunkText: 'Connector evidence.',
      score: 0.8,
      paragraphIndex: 0,
    };

    expect(sourceRefFromRagHit({ ...base, sourceId: 'onedrive:item:1', sourceType: 'onedrive' }).kind).toBe('onedrive');
    expect(sourceRefFromRagHit({ ...base, sourceId: 'esign:envelope:1', sourceType: 'esign' }).kind).toBe('esign');
    expect(sourceRefFromRagHit({ ...base, sourceId: 'meeting:event:1', sourceType: 'meeting' }).kind).toBe('meeting');
  });

  it('omits unknown or invalid page locators instead of rendering p. 0', () => {
    const base: RagHit = {
      path: '/Clients/Acme/notes.txt',
      chunkText: 'The source has no real page number.',
      score: 0.8,
      paragraphIndex: 0,
      sourceId: '/Clients/Acme/notes.txt',
      sourceType: 'txt',
    };

    expect(sourceRefFromRagHit({ ...base, pageNumber: 0 }).locator).toBeUndefined();
    expect(sourceRefFromRagHit({ ...base, pageNumber: -1 }).locator).toBeUndefined();
    expect(sourceRefFromRagHit({ ...base, locator: 'p. 0', pageNumber: 0 }).locator).toBeUndefined();
    expect(sourceRefFromRagHit({ ...base, pageNumber: 3 }).locator).toBe('p. 3');
  });

  it('builds an empty-but-valid ClientMap with the six section order', () => {
    const map = emptyClientMap('m1');
    expect(map.matterId).toBe('m1');
    expect(map.sections.map((s) => s.key)).toEqual(CORE_SECTION_ORDER);
    expect(map.completeness.level).toBe('thin');
    expect(map.pendingUpdates).toEqual([]);
  });
});
