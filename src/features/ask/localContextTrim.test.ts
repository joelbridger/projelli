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
    mode: 'files-only',
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

  it('files-only mode: reports fits=false when even the question + top-1 chunk cannot fit', () => {
    // Files-only mode answers ONLY from file evidence, so when no usable file
    // context fits, the honest move is to decline — never drop the last chunk
    // and answer from nothing (round-2 F2: this floor is files-only-specific).
    const hugeChunk = 'x'.repeat(100_000);
    const hits = [makeHit('only.md', 0.9, hugeChunk)];
    const result = trimForLocalContext(baseInput({ hits, mode: 'files-only' }), 16384);

    expect(result.fits).toBe(false);
    // Never drops below the single top chunk trying to make it fit.
    expect(result.hits).toHaveLength(1);
    expect(result.hits[0]?.path).toBe('only.md');
    expect(result.historyTurns).toHaveLength(0);
  });

  it('smart mode: drops a sole oversized chunk and keeps all history that fits (round-2 F2)', () => {
    // The follow-up scenario: "summarize what you just said" retrieves one
    // huge chunk that can never fit, but the answer lives in history. Smart
    // mode drops the chunk (zero fresh evidence — the caller's no-evidence
    // prompt stays honest) instead of erasing the history and refusing.
    const hugeChunk = 'x'.repeat(100_000);
    const hits = [makeHit('only.md', 0.9, hugeChunk)];
    const history = [
      makeTurn('what does the plan say?', 'The plan says to rebalance in Q3.'),
      makeTurn('anything else?', 'It also flags the concentrated position.'),
    ];
    const result = trimForLocalContext(
      baseInput({ hits, historyTurns: history, mode: 'smart' }),
      16384,
    );

    expect(result.fits).toBe(true);
    expect(result.trimmed).toBe(true);
    expect(result.hits).toHaveLength(0);
    // Both history turns fit once the oversized chunk is gone — all kept.
    expect(result.historyTurns.map((t) => t.question)).toEqual([
      'what does the plan say?',
      'anything else?',
    ]);
  });

  it('smart mode: after dropping the sole chunk, still trims oldest history to fit', () => {
    const hugeChunk = 'x'.repeat(100_000);
    const hits = [makeHit('only.md', 0.9, hugeChunk)];
    const history = [
      makeTurn('oldest q', 'oldest a '.repeat(200)),
      makeTurn('newest q', 'newest a '.repeat(200)),
    ];
    // Budget fits ONE restored history turn (plus fixed text), not both.
    const result = trimForLocalContext(
      baseInput({ hits, historyTurns: history, mode: 'smart' }),
      700 + LOCAL_TRIM_OUTPUT_RESERVE_TOKENS,
    );

    expect(result.fits).toBe(true);
    expect(result.hits).toHaveLength(0);
    // Oldest dropped, newest kept.
    expect(result.historyTurns.map((t) => t.question)).toEqual(['newest q']);
  });

  it('smart mode: does not drop the sole chunk when it fits with zero history', () => {
    // Evidence beats history — the chunk-drop is a last resort, only when the
    // chunk can NEVER fit. Here it fits once history is trimmed away, so the
    // top chunk survives (same chunks-over-history priority as before).
    const chunk = 'x'.repeat(1500);
    const hits = [makeHit('top.md', 0.9, chunk)];
    const history = [
      makeTurn('old q', 'old a '.repeat(200)),
      makeTurn('new q', 'new a '.repeat(200)),
    ];
    // Fits fixed + the chunk, but not fixed + chunk + any history turn.
    const result = trimForLocalContext(
      baseInput({ hits, historyTurns: history, mode: 'smart' }),
      500 + LOCAL_TRIM_OUTPUT_RESERVE_TOKENS,
    );

    expect(result.fits).toBe(true);
    expect(result.hits.map((h) => h.path)).toEqual(['top.md']);
    expect(result.historyTurns).toHaveLength(0);
  });

  it('smart mode: reports fits=false only when the fixed text alone exceeds the budget', () => {
    const result = trimForLocalContext(
      baseInput({ fixedText: 'x'.repeat(100_000), hits: [makeHit('a.md', 0.9, 'chunk')], mode: 'smart' }),
      16384,
    );
    expect(result.fits).toBe(false);
    expect(result.hits).toHaveLength(0);
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

  it('drops an oversized top hit and keeps the next best hit that fits', () => {
    // Round-3 finding: the #1-ranked chunk busts the budget all by itself, but
    // the #2-ranked chunk fits comfortably. The old lowest-first loop dropped
    // the usable #2 chunk before failing on #1 — usable evidence thrown away.
    const hits = [
      makeHit('oversized.md', 0.99, 'x'.repeat(100_000)),
      makeHit('usable.md', 0.9, 'short usable evidence'),
    ];
    const result = trimForLocalContext(baseInput({ hits, mode: 'files-only' }), 16384);

    expect(result.fits).toBe(true);
    expect(result.trimmed).toBe(true);
    expect(result.hits.map((h) => h.path)).toEqual(['usable.md']);
    // The surviving chunk is whole, never sliced.
    expect(result.hits[0]?.chunkText).toBe('short usable evidence');
  });

  it('smart mode: drops an oversized top hit and keeps the fitting hit plus history', () => {
    const hits = [
      makeHit('oversized.md', 0.99, 'x'.repeat(100_000)),
      makeHit('usable.md', 0.9, 'short usable evidence'),
    ];
    const history = [makeTurn('earlier q', 'earlier a')];
    const result = trimForLocalContext(
      baseInput({ hits, historyTurns: history, mode: 'smart' }),
      16384,
    );

    expect(result.fits).toBe(true);
    expect(result.trimmed).toBe(true);
    expect(result.hits.map((h) => h.path)).toEqual(['usable.md']);
    expect(result.historyTurns).toHaveLength(1);
  });

  it('skips an oversized mid-ranked chunk while keeping fitting chunks around it', () => {
    const hits = [
      makeHit('high.md', 0.9, 'small chunk that fits'),
      makeHit('huge-mid.md', 0.5, 'x'.repeat(100_000)),
      makeHit('low.md', 0.1, 'another small chunk'),
    ];
    const result = trimForLocalContext(baseInput({ hits }), 16384);

    expect(result.fits).toBe(true);
    expect(result.trimmed).toBe(true);
    // Best-ranked subset that can actually fit — the unsendable middle chunk
    // does not drag the lower-ranked (but fitting) chunk down with it.
    expect(result.hits.map((h) => h.path)).toEqual(['high.md', 'low.md']);
  });

  it('files-only mode: still declines honestly when every chunk is individually oversized', () => {
    const hits = [
      makeHit('huge1.md', 0.99, 'x'.repeat(100_000)),
      makeHit('huge2.md', 0.9, 'y'.repeat(100_000)),
    ];
    const result = trimForLocalContext(baseInput({ hits, mode: 'files-only' }), 16384);

    expect(result.fits).toBe(false);
    // Keeps the top chunk (unsent — the caller declines on fits=false).
    expect(result.hits.map((h) => h.path)).toEqual(['huge1.md']);
    expect(result.historyTurns).toHaveLength(0);
  });

  it('smart mode: still answers from history when every chunk is individually oversized', () => {
    const hits = [
      makeHit('huge1.md', 0.99, 'x'.repeat(100_000)),
      makeHit('huge2.md', 0.9, 'y'.repeat(100_000)),
    ];
    const history = [makeTurn('what did we cover?', 'We covered the rebalance plan.')];
    const result = trimForLocalContext(
      baseInput({ hits, historyTurns: history, mode: 'smart' }),
      16384,
    );

    expect(result.fits).toBe(true);
    expect(result.hits).toHaveLength(0);
    expect(result.historyTurns.map((t) => t.question)).toEqual(['what did we cover?']);
  });

  it('does not trim history when there are no chunks and it already fits', () => {
    const history = [makeTurn('q1', 'a1'), makeTurn('q2', 'a2')];
    const result = trimForLocalContext(baseInput({ historyTurns: history }), 16384);
    expect(result.trimmed).toBe(false);
    expect(result.historyTurns).toHaveLength(2);
  });
});
