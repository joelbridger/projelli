import { describe, expect, it } from 'vitest';
import { buildWorkspaceSources } from '@/features/ask/askHelpers';
import type { RagHit } from '@/platform/utils/tauri-commands';

function hit(overrides: Partial<RagHit> = {}): RagHit {
  return {
    id: 'chunk-1',
    path: '/clients/jordan/source.md',
    sourceId: 'source-1',
    chunkText: 'A client record',
    score: 0.9,
    paragraphIndex: 0,
    ...overrides,
  };
}

describe('dated retrieval hits', () => {
  it('carries explicit mail, document, and CRM source dates into assembled sources', () => {
    const sources = buildWorkspaceSources([
      hit({
        id: 'mail',
        sourceId: 'mail:message-1',
        sourceType: 'mail',
        sourceDate: { value: '2026-06-17T09:30:00Z', kind: 'received', confidence: 'source' },
      }),
      hit({
        id: 'document',
        sourceId: '/clients/jordan/policy.pdf',
        sourceType: 'pdf',
        sourceDate: { value: '2026-05-30T12:00:00Z', kind: 'document-modified', confidence: 'derived' },
      }),
      hit({
        id: 'crm',
        sourceId: 'crm:note-1',
        sourceType: 'crm',
        sourceDate: { value: '2026-04-03T14:00:00Z', kind: 'created', confidence: 'source' },
      }),
    ]);

    expect(sources.map((source) => source.sourceDate)).toEqual([
      { value: '2026-06-17T09:30:00.000Z', kind: 'received', confidence: 'source' },
      { value: '2026-05-30T12:00:00.000Z', kind: 'document-modified', confidence: 'derived' },
      { value: '2026-04-03T14:00:00.000Z', kind: 'created', confidence: 'source' },
    ]);
  });

  it('flags both newer and older incompatible evidence without changing retrieval order', () => {
    const sources = buildWorkspaceSources([
      hit({
        id: 'signed-policy',
        sourceId: '/clients/jordan/signed-policy.pdf',
        path: '/clients/jordan/signed-policy.pdf',
        sourceType: 'pdf',
        sourceDate: { value: '2026-05-30T12:00:00Z', kind: 'effective', confidence: 'source' },
        datedFact: {
          key: 'umbrella-limit',
          value: '$3 million',
          authorityReason: 'signed policy declaration',
        },
      }),
      hit({
        id: 'newer-email',
        sourceId: 'mail:carrier',
        path: 'mail:carrier',
        sourceType: 'mail',
        sourceDate: { value: '2026-06-17T09:30:00Z', kind: 'received', confidence: 'source' },
        datedFact: {
          key: 'umbrella-limit',
          value: '$5 million',
          authorityReason: 'email discussing a possible change',
        },
      }),
    ]);

    expect(sources.map((source) => source.id)).toEqual(['signed-policy', 'newer-email']);
    expect(sources[0].dateConflict).toMatchObject({
      relation: 'older-conflicts-with-newer',
      factKey: 'umbrella-limit',
      evidence: expect.arrayContaining([
        expect.objectContaining({ sourceId: '/clients/jordan/signed-policy.pdf', value: '$3 million' }),
        expect.objectContaining({ sourceId: 'mail:carrier', value: '$5 million' }),
      ]),
    });
    expect(sources[1].dateConflict).toMatchObject({
      relation: 'newer-conflicts-with-older',
      factKey: 'umbrella-limit',
      evidence: expect.arrayContaining([
        expect.objectContaining({ sourceId: '/clients/jordan/signed-policy.pdf', authorityReason: 'signed policy declaration' }),
        expect.objectContaining({ sourceId: 'mail:carrier', authorityReason: 'email discussing a possible change' }),
      ]),
    });
  });

  it('leaves old or invalid date rows readable as Date unavailable', () => {
    const [source] = buildWorkspaceSources([
      hit({
        sourceDate: { value: 'not-a-date', kind: 'received', rawValue: 'yesterday', confidence: 'source' },
      }),
    ]);

    expect(source.sourceDate).toEqual({
      value: null,
      kind: 'received',
      rawValue: 'yesterday',
      confidence: 'source',
    });
  });

  it('does not call a simple date difference a conflict', () => {
    const sources = buildWorkspaceSources([
      hit({
        id: 'older-policy',
        sourceDate: { value: '2026-05-01T00:00:00Z', kind: 'effective', confidence: 'source' },
        datedFact: { key: 'umbrella-limit', value: '$3 million' },
      }),
      hit({
        id: 'newer-policy-copy',
        sourceDate: { value: '2026-06-01T00:00:00Z', kind: 'received', confidence: 'source' },
        datedFact: { key: 'umbrella-limit', value: '$3 million' },
      }),
    ]);

    expect(sources.map((source) => source.dateConflict)).toEqual([undefined, undefined]);
  });
});
