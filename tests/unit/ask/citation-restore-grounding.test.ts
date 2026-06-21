/**
 * BUG-065 — restored (persisted) Ask citations must be RE-GROUNDED on reload,
 * never trusted by their saved `verified` flag. A citation is "source found"
 * (green) only when its EXACT locator still matches a saved source; a path-only
 * (pre-WS3, no locator) citation is kept but shown UNVERIFIED (red).
 */
import { describe, it, expect } from 'vitest';
import { reconstructTurns } from '@/features/ask/askHelpers';

type Msg = Parameters<typeof reconstructTurns>[0][number];

const session = (citation: Record<string, unknown>, sources: Record<string, unknown>[]): Msg[] =>
  [
    { role: 'user', content: 'Q', timestamp: '2026-01-01T00:00:00Z' },
    {
      role: 'assistant',
      content: 'A {1}',
      timestamp: '2026-01-01T00:00:00Z',
      askCitations: [citation],
      askSources: sources,
    },
  ] as unknown as Msg[];

describe('reconstructTurns — BUG-065 citation re-grounding on reload', () => {
  it('re-grounds an exact-locator citation to verified:true even if persisted verified was false', () => {
    const turns = reconstructTurns(
      session(
        { n: 1, label: 'f.md', excerpt: 'x', path: '/ws/f.md', locator: 'f', verified: false, paragraphIndex: 4 },
        [{ path: '/ws/f.md', chunkText: 'x', score: 0.9, paragraphIndex: 4 }],
      ),
    );
    expect(turns[0]?.citations).toHaveLength(1);
    expect(turns[0]?.citations[0]?.verified).toBe(true);
  });

  it('keeps a path-only (pre-WS3) citation but marks it UNVERIFIED, ignoring a persisted verified:true', () => {
    const turns = reconstructTurns(
      session(
        { n: 1, label: 'f.md', excerpt: 'x', path: '/ws/f.md', locator: 'f', verified: true /* no paragraphIndex */ },
        [{ path: '/ws/f.md', chunkText: 'x', score: 0.9, paragraphIndex: 4 }],
      ),
    );
    expect(turns[0]?.citations).toHaveLength(1); // kept (the file was retrieved)
    expect(turns[0]?.citations[0]?.verified).toBe(false); // but NOT green
  });

  it('drops a citation whose exact locator no longer matches any saved source', () => {
    const turns = reconstructTurns(
      session(
        { n: 1, label: 'f.md', excerpt: 'x', path: '/ws/f.md', locator: 'f', verified: true, paragraphIndex: 99 },
        [{ path: '/ws/f.md', chunkText: 'x', score: 0.9, paragraphIndex: 4 }],
      ),
    );
    // Locator 99 was never retrieved (only 4) → dropped, marker stripped.
    expect(turns[0]?.citations).toHaveLength(0);
    expect(turns[0]?.answer).not.toContain('{1}');
  });
});
