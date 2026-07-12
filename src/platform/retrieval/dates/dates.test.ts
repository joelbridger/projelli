import { describe, expect, it } from 'vitest';
import { buildDatedWorkspaceSources } from './assemble';
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
    const sources = buildDatedWorkspaceSources([
      hit({
        id: 'mail',
        sourceId: 'mail:message-1',
        sourceType: 'mail',
        sourceDate: {
          value: '2026-06-17T09:30:00Z',
          kind: 'received',
          confidence: 'source',
        },
      }),
      hit({
        id: 'document',
        sourceId: '/clients/jordan/policy.pdf',
        sourceType: 'pdf',
        sourceDate: {
          value: '2026-05-30T12:00:00Z',
          kind: 'document-modified',
          confidence: 'derived',
        },
      }),
      hit({
        id: 'crm',
        sourceId: 'crm:note-1',
        sourceType: 'crm',
        sourceDate: {
          value: '2026-04-03T14:00:00Z',
          kind: 'created',
          confidence: 'source',
        },
      }),
    ]);

    expect(sources.map((source) => source.sourceDate)).toEqual([
      {
        value: '2026-06-17T09:30:00.000Z',
        kind: 'received',
        confidence: 'source',
      },
      {
        value: '2026-05-30T12:00:00.000Z',
        kind: 'document-modified',
        confidence: 'derived',
      },
      {
        value: '2026-04-03T14:00:00.000Z',
        kind: 'created',
        confidence: 'source',
      },
    ]);
  });

  it('flags differently timestamped copies of the same mail record without changing retrieval order', () => {
    const sources = buildDatedWorkspaceSources([
      hit({
        id: 'mail-copy-older',
        sourceId: 'mail:message-copy-older',
        path: 'mail:message-copy-older',
        sourceType: 'mail',
        sourceDate: {
          value: '2026-05-30T12:00:00Z',
          kind: 'received',
          confidence: 'source',
        },
        datedFact: {
          key: 'mail-message:<jordan-review@example.test>:received-date',
          value: '2026-05-30T12:00:00Z',
        },
      }),
      hit({
        id: 'mail-copy-newer',
        sourceId: 'mail:message-copy-newer',
        path: 'mail:message-copy-newer',
        sourceType: 'mail',
        sourceDate: {
          value: '2026-06-17T09:30:00Z',
          kind: 'received',
          confidence: 'source',
        },
        datedFact: {
          key: 'mail-message:<jordan-review@example.test>:received-date',
          value: '2026-06-17T09:30:00Z',
        },
      }),
    ]);

    expect(sources.map((source) => source.id)).toEqual([
      'mail-copy-older',
      'mail-copy-newer',
    ]);
    const olderSource = sources.at(0);
    const newerSource = sources.at(1);
    expect(olderSource?.dateConflict).toMatchObject({
      relation: 'older-conflicts-with-newer',
      factKey: 'mail-message:<jordan-review@example.test>:received-date',
    });
    expect(olderSource?.dateConflict?.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceId: 'mail:message-copy-older',
          value: '2026-05-30T12:00:00Z',
        }),
        expect.objectContaining({
          sourceId: 'mail:message-copy-newer',
          value: '2026-06-17T09:30:00Z',
        }),
      ])
    );
    expect(newerSource?.dateConflict).toMatchObject({
      relation: 'newer-conflicts-with-older',
      factKey: 'mail-message:<jordan-review@example.test>:received-date',
    });
    expect(newerSource?.dateConflict?.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sourceId: 'mail:message-copy-older' }),
        expect.objectContaining({ sourceId: 'mail:message-copy-newer' }),
      ])
    );
  });

  it('leaves old or invalid date rows readable as Date unavailable', () => {
    const [source] = buildDatedWorkspaceSources([
      hit({
        sourceDate: {
          value: 'not-a-date',
          kind: 'received',
          rawValue: 'yesterday',
          confidence: 'source',
        },
      }),
    ]);

    expect(source?.sourceDate).toEqual({
      value: null,
      kind: 'received',
      rawValue: 'yesterday',
      confidence: 'source',
    });
  });

  it('does not call unrelated document facts a conflict', () => {
    const sources = buildDatedWorkspaceSources([
      hit({
        id: 'older-policy',
        sourceDate: {
          value: '2026-05-01T00:00:00Z',
          kind: 'effective',
          confidence: 'source',
        },
        datedFact: { key: 'policy-limit', value: '$3 million' },
      }),
      hit({
        id: 'newer-policy-copy',
        sourceDate: {
          value: '2026-06-01T00:00:00Z',
          kind: 'received',
          confidence: 'source',
        },
        datedFact: { key: 'carrier-email-limit', value: '$5 million' },
      }),
    ]);

    expect(sources.map((source) => source.dateConflict)).toEqual([
      undefined,
      undefined,
    ]);
  });
});
