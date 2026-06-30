/**
 * M5 — streaming diff engine.
 *
 * These are pure-function tests against the streaming diff utilities:
 *   - `computeLineDiff` — wraps the existing LCS diff so we re-verify
 *     it produces the expected shape our overlay consumes.
 *   - `splitIntoHunks` — groups contiguous change lines into hunks.
 *   - `applyHunks` — given an accept set, rebuilds the resolved text.
 *   - `stripAccidentalMarkdownFence` — post-stream cleanup.
 *
 * The streaming-over-time assertion walks a growing `proposed` string
 * and verifies the diff shape at each step, matching the overlay's
 * render loop.
 */

import { describe, it, expect } from 'vitest';
import {
  computeLineDiff,
  splitIntoHunks,
  applyHunks,
  stripAccidentalMarkdownFence,
} from '@/features/documents/editor/aiEdit/streamingDiff';

describe('computeLineDiff', () => {
  it('returns all unchanged when the two inputs are identical', () => {
    const lines = computeLineDiff('alpha\nbeta', 'alpha\nbeta');
    expect(lines.every((l) => l.type === 'unchanged')).toBe(true);
    expect(lines).toHaveLength(2);
  });

  it('marks additions as added and deletions as removed', () => {
    const lines = computeLineDiff('alpha\nbeta', 'alpha\ngamma');
    const types = lines.map((l) => l.type);
    expect(types).toContain('removed');
    expect(types).toContain('added');
    // alpha is unchanged; beta removed; gamma added.
    expect(lines.find((l) => l.content === 'alpha')?.type).toBe('unchanged');
    expect(lines.find((l) => l.content === 'beta')?.type).toBe('removed');
    expect(lines.find((l) => l.content === 'gamma')?.type).toBe('added');
  });
});

describe('splitIntoHunks', () => {
  it('returns no hunks when there are no changes', () => {
    const lines = computeLineDiff('a\nb', 'a\nb');
    expect(splitIntoHunks(lines)).toHaveLength(0);
  });

  it('groups contiguous change lines into one hunk', () => {
    const original = 'a\nb\nc';
    const proposed = 'a\nX\nc';
    const hunks = splitIntoHunks(computeLineDiff(original, proposed));
    expect(hunks).toHaveLength(1);
    expect(hunks[0]!.removedLines).toEqual(['b']);
    expect(hunks[0]!.addedLines).toEqual(['X']);
    expect(hunks[0]!.originalStart).toBe(1);
    expect(hunks[0]!.originalEnd).toBe(2);
  });

  it('splits non-contiguous changes into separate hunks', () => {
    const original = 'a\nb\nc\nd\ne';
    const proposed = 'a\nB\nc\nD\ne';
    const hunks = splitIntoHunks(computeLineDiff(original, proposed));
    expect(hunks).toHaveLength(2);
    expect(hunks[0]!.removedLines).toEqual(['b']);
    expect(hunks[0]!.addedLines).toEqual(['B']);
    expect(hunks[1]!.removedLines).toEqual(['d']);
    expect(hunks[1]!.addedLines).toEqual(['D']);
  });

  it('handles pure insertion hunks', () => {
    const original = 'a\nc';
    const proposed = 'a\nb\nc';
    const hunks = splitIntoHunks(computeLineDiff(original, proposed));
    expect(hunks).toHaveLength(1);
    expect(hunks[0]!.removedLines).toEqual([]);
    expect(hunks[0]!.addedLines).toEqual(['b']);
  });

  it('handles pure deletion hunks', () => {
    const original = 'a\nb\nc';
    const proposed = 'a\nc';
    const hunks = splitIntoHunks(computeLineDiff(original, proposed));
    expect(hunks).toHaveLength(1);
    expect(hunks[0]!.removedLines).toEqual(['b']);
    expect(hunks[0]!.addedLines).toEqual([]);
  });

  it('assigns stable indices in document order', () => {
    const original = 'a\nb\nc\nd\ne';
    const proposed = 'a\nB\nc\nD\ne';
    const hunks = splitIntoHunks(computeLineDiff(original, proposed));
    expect(hunks[0]!.index).toBe(0);
    expect(hunks[1]!.index).toBe(1);
  });
});

describe('applyHunks', () => {
  const original = 'a\nb\nc\nd\ne';
  const proposed = 'a\nB\nc\nD\ne';

  it('returns the original when no hunks are accepted', () => {
    const hunks = splitIntoHunks(computeLineDiff(original, proposed));
    expect(applyHunks(original, hunks, new Set())).toBe(original);
  });

  it('returns the fully-rewritten text when all hunks are accepted', () => {
    const hunks = splitIntoHunks(computeLineDiff(original, proposed));
    const acceptAll = new Set(hunks.map((h) => h.index));
    expect(applyHunks(original, hunks, acceptAll)).toBe(proposed);
  });

  it('applies only the accepted hunk and leaves others alone', () => {
    const hunks = splitIntoHunks(computeLineDiff(original, proposed));
    // Accept hunk 0 only.
    const result = applyHunks(original, hunks, new Set([0]));
    expect(result).toBe('a\nB\nc\nd\ne');
  });

  it('applies only the second hunk when only it is accepted', () => {
    const hunks = splitIntoHunks(computeLineDiff(original, proposed));
    const result = applyHunks(original, hunks, new Set([1]));
    expect(result).toBe('a\nb\nc\nD\ne');
  });

  it('handles pure insertion hunks', () => {
    const orig = 'a\nc';
    const prop = 'a\nb\nc';
    const hunks = splitIntoHunks(computeLineDiff(orig, prop));
    expect(applyHunks(orig, hunks, new Set([0]))).toBe(prop);
    expect(applyHunks(orig, hunks, new Set())).toBe(orig);
  });

  it('handles pure deletion hunks', () => {
    const orig = 'a\nb\nc';
    const prop = 'a\nc';
    const hunks = splitIntoHunks(computeLineDiff(orig, prop));
    expect(applyHunks(orig, hunks, new Set([0]))).toBe(prop);
    expect(applyHunks(orig, hunks, new Set())).toBe(orig);
  });
});

describe('streaming simulation', () => {
  /**
   * Walks a growing `proposed` string token-by-token and verifies the
   * diff shape at each step. This mirrors what the overlay does on
   * every `onChunk` callback: recompute diff and split into hunks.
   */
  it('diff shape evolves monotonically as tokens stream in', () => {
    const original = 'The quick brown fox jumps over the lazy dog.';
    const finalProposed = 'The quick red fox leaps over the lazy dog.';
    const tokens = finalProposed.split(' ');

    let proposed = '';
    let seenAnyDiff = false;
    for (const token of tokens) {
      proposed = proposed.length > 0 ? `${proposed} ${token}` : token;
      const lines = computeLineDiff(original, proposed);
      // Shape invariants:
      expect(lines.length).toBeGreaterThan(0);
      // Every line object has a known type.
      for (const line of lines) {
        expect(['unchanged', 'added', 'removed']).toContain(line.type);
      }
      const hunks = splitIntoHunks(lines);
      if (hunks.length > 0) seenAnyDiff = true;
      // Hunks never overlap.
      for (let i = 1; i < hunks.length; i += 1) {
        expect(hunks[i]!.originalStart).toBeGreaterThanOrEqual(hunks[i - 1]!.originalEnd);
      }
    }
    expect(seenAnyDiff).toBe(true);

    // Final state: applying all accepted hunks yields the proposed text.
    const finalLines = computeLineDiff(original, finalProposed);
    const finalHunks = splitIntoHunks(finalLines);
    const accept = new Set(finalHunks.map((h) => h.index));
    expect(applyHunks(original, finalHunks, accept)).toBe(finalProposed);
  });

  it('partial stream produces a diff (overlay always has something to show)', () => {
    const original = 'alpha beta gamma';
    // Imagine the AI got as far as "alpha BETA" before we checked.
    const partial = 'alpha BETA';
    const lines = computeLineDiff(original, partial);
    expect(lines.some((l) => l.type !== 'unchanged')).toBe(true);
  });
});

describe('stripAccidentalMarkdownFence', () => {
  it('leaves un-fenced text untouched', () => {
    expect(stripAccidentalMarkdownFence('Hello world', true)).toBe('Hello world');
  });

  it('strips outermost fence when the whole reply is wrapped', () => {
    const wrapped = '```\nHello\nworld\n```';
    expect(stripAccidentalMarkdownFence(wrapped, true)).toBe('Hello\nworld');
  });

  it('does not strip mid-stream (avoids flicker)', () => {
    const partial = '```\nHello';
    expect(stripAccidentalMarkdownFence(partial, false)).toBe(partial);
  });

  it('leaves inner fenced blocks alone when they are not the outer wrapper', () => {
    const text = 'some prose\n```\ncode\n```\nmore prose';
    expect(stripAccidentalMarkdownFence(text, true)).toBe(text);
  });
});
