// Streaming diff engine for M5 inline AI edits.
//
// This is a small layer on top of `src/utils/diff.ts` (LCS line diff).
// The LCS implementation is already in the repo, already covered by
// existing tests, and is small enough that recomputing it after every
// streamed token is fine for a selection of a few dozen lines — which
// is the realistic user case for "tighten this paragraph".
//
// We deliberately do NOT pull in `diff` / `jsdiff` from npm: it's
// another ~30 KB, its Myers implementation would be slightly faster
// for very long diffs, and the existing LCS diff is already the
// standard for the read-only DiffViewer. Keeping one diff algorithm
// across the app makes the streaming overlay visually consistent with
// version-history preview.

import { computeDiff, type DiffLine } from '@/utils/diff';
import type { DiffHunk } from './types';

/**
 * Compute DiffLine[] for `original` vs `proposed`. Thin wrapper kept
 * here so the overlay component doesn't have to know where the LCS
 * diff lives, and so future changes (switch to a different algorithm,
 * add word-level diff, etc.) are localized.
 */
export function computeLineDiff(original: string, proposed: string): DiffLine[] {
  return computeDiff(original, proposed).lines;
}

/**
 * Split a sequence of DiffLines into contiguous change hunks.
 *
 * A hunk is a maximal run of `added` and `removed` lines with no
 * `unchanged` line between them. Each hunk captures enough context to
 * later be "applied" against the original — we record both the
 * original-side line range and the proposed-side line range.
 *
 * This is a straightforward single-pass scan: O(n).
 */
export function splitIntoHunks(lines: DiffLine[]): DiffHunk[] {
  const hunks: DiffHunk[] = [];

  // Track current-line indices on both sides. We increment these as
  // we walk the diff: 'unchanged' advances both, 'removed' advances
  // only original, 'added' advances only proposed.
  let origIdx = 0;
  let propIdx = 0;

  // Current in-flight hunk (null between hunks).
  let current: {
    originalStart: number;
    proposedStart: number;
    removedLines: string[];
    addedLines: string[];
  } | null = null;

  const flush = () => {
    if (!current) return;
    hunks.push({
      index: hunks.length,
      originalStart: current.originalStart,
      originalEnd: current.originalStart + current.removedLines.length,
      proposedStart: current.proposedStart,
      proposedEnd: current.proposedStart + current.addedLines.length,
      removedLines: current.removedLines,
      addedLines: current.addedLines,
    });
    current = null;
  };

  for (const line of lines) {
    if (line.type === 'unchanged') {
      flush();
      origIdx += 1;
      propIdx += 1;
      continue;
    }
    if (!current) {
      current = {
        originalStart: origIdx,
        proposedStart: propIdx,
        removedLines: [],
        addedLines: [],
      };
    }
    if (line.type === 'removed') {
      current.removedLines.push(line.content);
      origIdx += 1;
    } else {
      current.addedLines.push(line.content);
      propIdx += 1;
    }
  }
  flush();

  return hunks;
}

/**
 * Apply a set of accepted hunks to the original text, keeping rejected
 * hunks as-is. Returns the new text after resolution.
 *
 * The algorithm:
 *   1. Split the original into lines.
 *   2. For each hunk in order, either splice in the replacement (accept)
 *      or keep the removed lines (reject).
 *   3. Lines between hunks are passed through unchanged.
 *
 * Works for partial acceptance — accept hunk 0, reject hunk 1 — and
 * is deterministic regardless of the order accept/reject decisions
 * are made in (because we always re-build from the original).
 */
export function applyHunks(
  original: string,
  hunks: DiffHunk[],
  accepted: Set<number>
): string {
  const originalLines = original.split('\n');
  const resultLines: string[] = [];

  let cursor = 0; // next original line to emit

  for (const hunk of hunks) {
    // Emit untouched lines leading up to this hunk.
    while (cursor < hunk.originalStart) {
      resultLines.push(originalLines[cursor] ?? '');
      cursor += 1;
    }

    if (accepted.has(hunk.index)) {
      // Accept: replace removed range with addedLines.
      resultLines.push(...hunk.addedLines);
    } else {
      // Reject: keep the originals in this range.
      for (let i = hunk.originalStart; i < hunk.originalEnd; i += 1) {
        resultLines.push(originalLines[i] ?? '');
      }
    }

    cursor = hunk.originalEnd;
  }

  // Trailing untouched lines.
  while (cursor < originalLines.length) {
    resultLines.push(originalLines[cursor] ?? '');
    cursor += 1;
  }

  return resultLines.join('\n');
}

/**
 * Trim wrapping markdown fences / preamble that models sometimes emit
 * even when we explicitly tell them not to. Only strips an outermost
 * fenced block if the WHOLE response is one; never touches partial
 * streams mid-stream.
 *
 * Intentionally conservative: if we can't be confident the whole reply
 * is a fenced wrapper, we pass through unchanged.
 */
export function stripAccidentalMarkdownFence(text: string, streamFinished: boolean): string {
  if (!streamFinished) return text;
  const trimmed = text.trim();
  if (!trimmed.startsWith('```')) return text;
  const firstNewline = trimmed.indexOf('\n');
  if (firstNewline < 0) return text;
  if (!trimmed.endsWith('```')) return text;
  const inner = trimmed.slice(firstNewline + 1, trimmed.length - 3);
  return inner.replace(/\n$/, '');
}
