// Paragraph-level text diff for turning a USER's plain-text edit of a paragraph
// into tracked insertion/deletion(s) (WS-A / A4, secondary).
//
// When the editor is in "Reviewing" (track-changes) mode and the user edits a
// plain run, we don't want to silently overwrite the text — we want the change
// to show up as a tracked change attributed to the user, exactly like Word's
// "Track Changes: On". This computes a minimal word-level diff between the old
// and new paragraph text and emits `DocxAiEdit`s (the same op shape the batch
// engine command consumes) describing the change.
//
// A paragraph-level word diff is the agreed v1 granularity: it's robust, easy to
// reason about, and good enough for the "type and it becomes a tracked change"
// experience. We reuse the drift-safe batch command to apply the result, so the
// anchoring + id allocation logic is shared with the AI redline path.

import type { DocxAiEdit } from '@/platform/types/docx';

/**
 * Split text into tokens that preserve whitespace, so reconstructed strings are
 * exact. Each token is either a run of non-space chars or a run of spaces.
 */
function tokenize(text: string): string[] {
  const out = text.match(/\s+|\S+/g);
  return out ?? [];
}

/** Read a cell from the LCS table, treating out-of-bounds as 0. */
function cell(dp: number[][], i: number, j: number): number {
  return dp[i]?.[j] ?? 0;
}

/**
 * Classic LCS over tokens, returning the common-subsequence length table.
 * O(n*m) — paragraphs are short, so this is fine. `dp[i][j]` = LCS length of
 * `a[i..]` and `b[j..]`, so `dp[0][0]` is the full LCS length.
 */
function lcsTable(a: string[], b: string[]): number[][] {
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () =>
    new Array<number>(m + 1).fill(0),
  );
  for (let i = n - 1; i >= 0; i--) {
    const row = dp[i] ?? [];
    for (let j = m - 1; j >= 0; j--) {
      row[j] = a[i] === b[j] ? cell(dp, i + 1, j + 1) + 1 : Math.max(cell(dp, i + 1, j), cell(dp, i, j + 1));
    }
  }
  return dp;
}

interface DiffSpan {
  type: 'equal' | 'delete' | 'insert';
  text: string;
}

/**
 * Word-level diff of `oldText` -> `newText` as a list of contiguous spans.
 * Adjacent same-type spans are merged so we emit as few edits as possible.
 */
export function diffSpans(oldText: string, newText: string): DiffSpan[] {
  const a = tokenize(oldText);
  const b = tokenize(newText);
  const dp = lcsTable(a, b);
  const raw: DiffSpan[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const ai = a[i] ?? '';
    const bj = b[j] ?? '';
    if (ai === bj) {
      raw.push({ type: 'equal', text: ai });
      i++;
      j++;
    } else if (cell(dp, i + 1, j) >= cell(dp, i, j + 1)) {
      raw.push({ type: 'delete', text: ai });
      i++;
    } else {
      raw.push({ type: 'insert', text: bj });
      j++;
    }
  }
  while (i < a.length) {
    raw.push({ type: 'delete', text: a[i] ?? '' });
    i++;
  }
  while (j < b.length) {
    raw.push({ type: 'insert', text: b[j] ?? '' });
    j++;
  }

  // Merge adjacent same-type spans.
  const merged: DiffSpan[] = [];
  for (const span of raw) {
    const last = merged[merged.length - 1];
    if (last && last.type === span.type) {
      last.text += span.text;
    } else {
      merged.push({ ...span });
    }
  }
  return merged;
}

/**
 * Convert a user's edit of paragraph `paragraphIndex` (old plain-run text ->
 * new text) into `DocxAiEdit`s anchored against the OLD text. Anchors are the
 * text immediately preceding each change so the batch engine can locate the
 * change point in the original paragraph.
 *
 * Strategy: walk the diff spans, tracking the running anchor (the equal text
 * consumed so far). For a delete span, emit a `delete` whose anchorText is the
 * deleted text. For an insert span, emit an `insert` placed AFTER the preceding
 * equal text (or at paragraph end when there is none yet). A delete+insert at
 * the same point is emitted as a `replace` so it groups as one tracked change.
 *
 * Returns `[]` when old === new (no-op).
 */
export function diffParagraphEdits(
  paragraphIndex: number,
  oldText: string,
  newText: string,
): DocxAiEdit[] {
  if (oldText === newText) return [];

  const spans = diffSpans(oldText, newText);
  const edits: DocxAiEdit[] = [];
  // The equal text immediately preceding the current change point. Used as the
  // insert anchor so insertions land in the right spot.
  let precedingEqual = '';

  for (let k = 0; k < spans.length; k++) {
    const span = spans[k];
    if (!span) continue;
    if (span.type === 'equal') {
      precedingEqual = span.text;
      continue;
    }

    // Look for an adjacent delete+insert pair => a single replace.
    const next = spans[k + 1];
    if (span.type === 'delete' && next && next.type === 'insert') {
      edits.push({
        op: 'replace',
        paragraphIndex,
        anchorText: span.text,
        newText: next.text,
        reason: 'User edit',
      });
      k++; // consume the insert
      precedingEqual = '';
      continue;
    }
    if (span.type === 'delete') {
      edits.push({
        op: 'delete',
        paragraphIndex,
        anchorText: span.text,
        reason: 'User edit',
      });
      precedingEqual = '';
      continue;
    }
    // Pure insertion: anchor after the preceding equal text (if any). No
    // preceding equal text only happens for the very first span in the whole
    // diff (an adjacent delete+insert pair is always merged into 'replace'
    // above, so a later standalone insert always has real preceding text) —
    // i.e. this insertion sits at the literal start of the paragraph. Mark it
    // explicitly with `atParagraphStart` rather than leaving `anchorText`
    // unset, because an unset anchor means "append at the end" to the engine
    // (CLUSTER-C4) — leaving it implicit silently moved start-of-paragraph
    // edits to the end of the paragraph instead.
    const insert: DocxAiEdit = {
      op: 'insert',
      paragraphIndex,
      newText: span.text,
      reason: 'User edit',
    };
    if (precedingEqual.length > 0) {
      insert.anchorText = precedingEqual;
    } else {
      insert.atParagraphStart = true;
    }
    edits.push(insert);
    precedingEqual = '';
  }

  return edits;
}
