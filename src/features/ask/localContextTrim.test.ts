import { describe, it, expect } from 'vitest';
import {
  trimForLocalContext,
  LOCAL_TRIM_OUTPUT_RESERVE_TOKENS,
  type LocalTrimInput,
} from './localContextTrim';
import type { RagHit } from '@/platform/utils/tauri-commands';
import type { AskTurn } from './askHelpers';

function makeHit(path: string, score: number, chunkText: string): RagHit {
  return { path, score, chunkText, paragraphIndex: 0 };
}

function makeTurn(question: string, answer: string): AskTurn {
  return { question, answer, citations: [], sources: [] };
}

/** Simple, real-shaped builders — join hits/turns into text roughly the way
 *  the app's buildWorkspaceContextBlock / buildHistoryBlock do, so token
 *  estimates scale with how many items survive. */
function buildWorkspaceBlock(hits: RagHit[]): string {
  if (hits.length === 0) return '';
  return hits.map((h) => `[${h.path}]\n${h.chunkText}`).join('\n\n');
}

function buildHistoryBlock(turns: AskTurn[]): string {
  if (turns.length === 0) return '';
  return turns.map((t) => `Q: ${t.question}\nA: ${t.answer}`).join('\n');
}

function baseInput(overrides: Partial<LocalTrimInput> = {}): LocalTrimInput {
  return {
    fixedText: 'You are a helpful assistant. Question: what is the plan?',
    hits: [],
    historyTurns: [],
    buildWorkspaceBlock,
    buildHistoryBlock,
    ...overrides,
  };
}

describe('trimForLocalContext', () => {
  it('leaves an under-budget prompt untouched', () => {
    const hits = [makeHit('a.md', 0.9, 'short chunk A'), makeHit('b.md', 0.5, 'short chunk B')];
    const history = [makeTurn('earlier q', 'earlier a')];
    const result = trimForLocalContext(baseInput({ hits, historyTurns: history }), 16384);

    expect(result.fits).toBe(true);
    expect(result.trimmed).toBe(false);
    expect(result.hits).toHaveLength(2);
    expect(result.historyTurns).toHaveLength(1);
    // Untouched chunk text is verbatim — never partially truncated.
    expect(result.hits.map((h) => h.chunkText)).toEqual(['short chunk A', 'short chunk B']);
  });

  it('drops the lowest-relevance chunk first when over budget', () => {
    const bigChunk = 'x'.repeat(2000);
    const hits = [
      makeHit('high.md', 0.9, bigChunk),
      makeHit('mid.md', 0.5, bigChunk),
      makeHit('low.md', 0.1, bigChunk),
    ];
    // Tiny window forces trimming.
    const maxContextTokens = 300;
    const result = trimForLocalContext(baseInput({ hits }), maxContextTokens);

    expect(result.trimmed).toBe(true);
    // Only the highest-relevance chunk should survive at this tiny budget.
    expect(result.hits.map((h) => h.path)).toEqual(['high.md']);
    // Surviving chunk text is whole, not sliced.
    expect(result.hits[0]?.chunkText).toBe(bigChunk);
  });

  it('keeps chunks in relevance order regardless of input order', () => {
    const hits = [
      makeHit('low.md', 0.1, 'a'),
      makeHit('high.md', 0.9, 'b'),
      makeHit('mid.md', 0.5, 'c'),
    ];
    const result = trimForLocalContext(baseInput({ hits }), 16384);
    expect(result.hits.map((h) => h.path)).toEqual(['high.md', 'mid.md', 'low.md']);
  });

  it('trims oldest history only after chunks are already down to the top-1 floor', () => {
    const bigChunk = 'x'.repeat(1500);
    const hits = [makeHit('high.md', 0.9, bigChunk), makeHit('low.md', 0.1, bigChunk)];
    const history = [
      makeTurn('oldest q', 'oldest a'.repeat(100)),
      makeTurn('newer q', 'newer a'.repeat(100)),
    ];
    // Budget big enough for fixed + 1 chunk + history isn't guaranteed, tuned
    // to force cutting the low-relevance chunk AND the oldest history turn.
    const maxContextTokens = 700 + LOCAL_TRIM_OUTPUT_RESERVE_TOKENS;
    const result = trimForLocalContext(baseInput({ hits, historyTurns: history }), maxContextTokens);

    expect(result.trimmed).toBe(true);
    expect(result.hits.map((h) => h.path)).toEqual(['high.md']);
    // Oldest turn dropped, newest kept.
    expect(result.historyTurns.map((t) => t.question)).toEqual(['newer q']);
  });

  it('reports fits=false when even the question + top-1 chunk cannot fit', () => {
    const hugeChunk = 'x'.repeat(100_000);
    const hits = [makeHit('only.md', 0.9, hugeChunk)];
    const result = trimForLocalContext(baseInput({ hits }), 16384);

    expect(result.fits).toBe(false);
    // Never drops below the single top chunk trying to make it fit.
    expect(result.hits).toHaveLength(1);
    expect(result.hits[0]?.path).toBe('only.md');
    expect(result.historyTurns).toHaveLength(0);
  });

  it('reports fits=false when the fixed text alone already exceeds the budget', () => {
    const result = trimForLocalContext(
      baseInput({ fixedText: 'x'.repeat(100_000) }),
      16384,
    );
    expect(result.fits).toBe(false);
    expect(result.hits).toHaveLength(0);
    expect(result.historyTurns).toHaveLength(0);
  });

  it('does not trim history when there are no chunks and it already fits', () => {
    const history = [makeTurn('q1', 'a1'), makeTurn('q2', 'a2')];
    const result = trimForLocalContext(baseInput({ historyTurns: history }), 16384);
    expect(result.trimmed).toBe(false);
    expect(result.historyTurns).toHaveLength(2);
  });
});
