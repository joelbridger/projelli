// Pure-JS Markdown pipe-table detection/normalization utilities for the AI
// redliner. Deliberately split out of docx-io.ts: docx-io.ts pulls in mammoth,
// docx-preview, JSZip, and the `docx` library (its actual .docx read/write
// engine), while these functions are plain string/regex logic with zero
// dependency on any of that. Keeping them in their own file lets a caller that
// only needs table detection (docx-commands.ts, reached from the always-on
// document editor) avoid dragging the heavy DOCX engine into its bundle chunk.

/**
 * True when `markdown` contains a GFM Markdown table (a header/separator pair
 * where the separator row is `|---|`-shaped).
 */
export function containsMarkdownTable(markdown: string): boolean {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  for (let i = 1; i < lines.length; i++) {
    const sep = (lines[i] ?? '').trim();
    const header = (lines[i - 1] ?? '').trim();
    if (
      /^[|\s:-]+$/.test(sep) &&
      sep.includes('-') &&
      sep.includes('|') &&
      header.includes('|')
    ) {
      return true;
    }
  }
  return false;
}

/**
 * One body-level block produced from a Markdown fragment for the AI redliner:
 * either a paragraph (carrying its plain text, so the redliner can add it as a
 * TRACKED, editable paragraph) or a table (carrying real `<w:tbl>` XML, added as
 * a preserved raw block — the engine has no block-level revision model, so a
 * table can't itself be a tracked change).
 */
export type RedlineBlock =
  | { kind: 'paragraph'; text: string }
  | { kind: 'table'; xml: string };

/**
 * True when `markdown` is EXACTLY one GFM pipe table and nothing else (ignoring
 * leading/trailing blank lines). STRICTER than {@link containsMarkdownTable}:
 * used to gate AI-redline table inserts so we only ever convert a clean,
 * standalone table. Any surrounding prose — even a single line, even prose that
 * merely contains a `|` (which the lenient converter would silently fold into,
 * or drop from, the table) — makes this false, so the caller rejects the edit
 * instead of losing or reshaping that text.
 *
 * Requires, after trimming outer blank lines: at least two lines, NO internal
 * blank line, every line contains a `|`, and the SECOND line is a GFM separator
 * row (dashes/colons/pipes with at least one dash). The "separator must be line
 * two" rule is what rejects `Note A | B\n| H | I |\n|---|---|` — prose that would
 * otherwise masquerade as the table's header row.
 */
export function isStandaloneMarkdownTable(markdown: string): boolean {
  const raw = markdown.replace(/\r\n/g, '\n').split('\n');
  let start = 0;
  let end = raw.length;
  while (start < end && (raw[start] ?? '').trim() === '') start++;
  while (end > start && (raw[end - 1] ?? '').trim() === '') end--;
  const lines = raw.slice(start, end).map((l) => l.trim());
  if (lines.length < 2) return false;
  // No blank lines inside, and every line must look like a pipe row.
  if (lines.some((l) => l === '' || !l.includes('|'))) return false;
  // The SECOND line must be the separator row (header, separator, body...).
  const sep = lines[1] ?? '';
  return /^[|\s:-]+$/.test(sep) && sep.includes('-');
}

/**
 * Split a pipe-table row into trimmed cell strings, tolerating BOTH outer-pipe
 * (`| a | b |`) and no-outer-pipe (`a | b`) styles — mirrors the converter's own
 * `splitTableRow` so detection and rendering agree on the column count.
 */
function splitPipeCells(line: string): string[] {
  const t = line.trim();
  const inner = t.replace(/^\|/, '').replace(/\|$/, '');
  return inner.split('|').map((c) => c.trim());
}

/**
 * Column count of a pipe-table row (0 when the line has no `|` at all, so a
 * pipe-free prose line is never mistaken for a one-cell row).
 */
function pipeColumnCount(line: string): number {
  return line.includes('|') ? splitPipeCells(line).length : 0;
}

/** True when a trimmed line is a GFM separator row (`|---|`, `--- | ---`, …). */
function isSeparatorRow(line: string): boolean {
  const t = line.trim();
  return /^[|\s:-]+$/.test(t) && t.includes('-') && t.includes('|');
}

/**
 * True when `text` contains a BLOCK of at least two consecutive pipe-table rows
 * — WITH or WITHOUT a `|---|` separator row, WITH or WITHOUT outer pipes — that
 * share the same column count (≥2 columns). This is broader than {@link
 * containsMarkdownTable} (which requires a separator row) on purpose: real model
 * output for "add a small table" frequently OMITS the separator row
 * (`|Name|Value|` / `|Alpha|42|`, or `Name | Value` / `Alpha | 42`), and that
 * MUST still be recognized as a table so it becomes a real `<w:tbl>` (or is
 * rejected) rather than leaking as literal pipe text. The "same column count on
 * two adjacent lines" rule is what keeps ordinary prose with a single stray pipe
 * ("$50k | year") from being mistaken for a table.
 */
export function containsPipeTableLikeBlock(text: string): boolean {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  for (let i = 1; i < lines.length; i++) {
    const prev = pipeColumnCount(lines[i - 1] ?? '');
    const cur = pipeColumnCount(lines[i] ?? '');
    if (prev >= 2 && cur >= 2 && prev === cur) return true;
  }
  return false;
}

/**
 * If `text` is a CLEAN, standalone pipe table — every non-blank line is a pipe
 * row, at least two rows, no interleaved prose or blank lines — return it as a
 * canonical GFM Markdown table (outer pipes on every row, with a proper `|---|`
 * separator row synthesized from the header's column count when the model
 * omitted one) that `markdownToRedlineBlocks` (in `docx-io.ts`) converts to a
 * real `<w:tbl>`. Otherwise return `null` so the caller REJECTS the edit rather
 * than risk leaking literal pipes or silently losing text.
 *
 * Handles every shape models actually emit: outer/no-outer pipes, tight/spaced
 * separators, and a missing separator row. For a separator-less block it also
 * requires a CONSISTENT column count across all rows — a rectangular table, not
 * ragged prose — as the anti-false-positive guard. This is the normalization the
 * AI redliner runs BEFORE converting a table, closing the gap between what
 * models emit and what the converter needs, without ever passing pipe syntax
 * through as prose.
 */
export function normalizeStandalonePipeTable(text: string): string | null {
  const raw = text.replace(/\r\n/g, '\n').split('\n');
  let start = 0;
  let end = raw.length;
  while (start < end && (raw[start] ?? '').trim() === '') start++;
  while (end > start && (raw[end - 1] ?? '').trim() === '') end--;
  const lines = raw.slice(start, end).map((l) => l.trim());
  // Need a header + at least one more row, no internal blank lines, and every
  // line must contain a `|` (a prose line with no pipe means this isn't a clean
  // standalone table — reject rather than fold/drop it).
  if (lines.length < 2) return null;
  if (lines.some((l) => l === '' || !l.includes('|'))) return null;

  const cols = pipeColumnCount(lines[0] ?? '');
  if (cols < 1) return null;

  const sepIndex = lines.findIndex((l) => isSeparatorRow(l));
  let bodyLines: string[];
  if (sepIndex >= 0) {
    // A separator row is an unambiguous table signal (so even a one-column table
    // is honored) — but it must sit directly under the header (GFM), else the
    // "header" is really prose above a table.
    if (sepIndex !== 1) return null;
    // The separator declares the column count; if it disagrees with the header
    // the table is malformed/ambiguous — reject rather than guess.
    if (pipeColumnCount(lines[1] ?? '') !== cols) return null;
    bodyLines = lines.slice(2);
  } else {
    // No separator row → the table shape is a guess. Require a RECTANGULAR block
    // of at least two columns (every row the same column count) so two lines of
    // prose that merely share a stray pipe aren't turned into a table.
    if (cols < 2) return null;
    if (!lines.every((l) => pipeColumnCount(l) === cols)) return null;
    bodyLines = lines.slice(1);
  }

  // Data-loss guard: a body row with MORE cells than the header would be
  // truncated by canonicalization, silently dropping text. Reject instead.
  // (Fewer cells is fine — GFM pads the row with empty cells, losing nothing.)
  if (bodyLines.some((l) => pipeColumnCount(l) > cols)) return null;

  const rowToCanonical = (cells: string[]): string => {
    const padded = cells.slice(0, cols);
    while (padded.length < cols) padded.push('');
    return `| ${padded.join(' | ')} |`;
  };
  const header = rowToCanonical(splitPipeCells(lines[0] ?? ''));
  const separator = `|${Array.from({ length: cols }, () => ' --- ').join('|')}|`;
  const body = bodyLines.map((l) => rowToCanonical(splitPipeCells(l)));
  return [header, separator, ...body].join('\n');
}
