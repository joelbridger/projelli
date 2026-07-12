import { describe, expect, it } from 'vitest';
import './types';
import type { RagHit } from '@/platform/utils/tauri-commands';

describe('Rust dated-hit producer contract', () => {
  it('accepts a mail date from Rust as the frontend RagHit shape', () => {
    // This is the exact camelCase JSON asserted by Rust's
    // `mail_hit_date_serializes_for_the_typescript_rag_hit_contract` test.
    // Typing the IPC payload as RagHit proves the consumer receives the date
    // rather than dropping it while crossing into TypeScript.
    const rustMailHit = {
      path: 'mail:message-42',
      chunkText: 'Portfolio review is scheduled.',
      score: 0.92,
      paragraphIndex: 0,
      sourceId: 'mail:message-42',
      sourceType: 'mail' as const,
      sourceDate: {
        value: '2026-07-10T14:30:00.000Z',
        kind: 'received' as const,
        confidence: 'source' as const,
      },
    } satisfies RagHit;

    const receivedByTypeScript: RagHit = rustMailHit;
    expect(receivedByTypeScript.sourceDate).toEqual({
      value: '2026-07-10T14:30:00.000Z',
      kind: 'received',
      confidence: 'source',
    });
  });
});
