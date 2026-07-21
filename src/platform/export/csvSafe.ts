// THE CSV CHOKEPOINT.
//
// Every byte this product writes into a `.csv` goes through this module. Five
// CSV writers were found by hand in earlier rounds and a sixth was still
// hiding (`spreadsheet-io.ts`'s non-formula branch), which is what a
// hand-maintained list of writers always produces: it defaults to GREEN for
// every writer nobody thought of. `scripts/check-untrusted-sink-derivation.mjs`
// derives the writer set from ground truth and requires each member to reach
// this file, so the seventh writer reds the gate on the commit that adds it.
//
// WHAT THE GUARD IS
// -----------------
// A spreadsheet application treats a cell whose first character is `=`, `+`,
// `-`, `@`, TAB or CR as a FORMULA. `=cmd|'/c calc'!A1` in a name field is a
// command that runs when the advisor opens the export. Prefixing with an
// apostrophe makes the application render it as literal text — the apostrophe
// itself is not shown.
//
// THE THREE WAYS OUT, AND WHY THERE ARE EXACTLY THREE
// --------------------------------------------------
//   csvCell(value)            — guarded. THE DEFAULT.
//   csvFormulaCell(formula)   — deliberately emits a formula. Named, so it is
//                               greppable and reviewable; the caller has said
//                               "this cell IS a formula", not "I forgot".
//   csvVerbatimCell(v, why)   — deliberately unguarded, REASON REQUIRED. The
//                               reason is a runtime argument, not a comment,
//                               so it cannot be deleted without changing code.
//
// A fourth way out would be a bug. `csvRow` / `csvDocument` only accept the
// already-encoded output of one of the three, via the branded `CsvCell` type,
// so a plain `string` cannot be smuggled into a row without a cast.

/**
 * An encoded CSV field. Branded so a raw `string` cannot be passed to
 * `csvRow`: the only way to obtain one is through `csvCell`, `csvFormulaCell`
 * or `csvVerbatimCell`, each of which has made an explicit decision about the
 * formula guard.
 */
export type CsvCell = string & { readonly __csvEncoded: unique symbol };

/** Values a caller may hand to `csvCell` without stringifying first. */
export type CsvValue = string | number | boolean | null | undefined;

/**
 * Characters that make a spreadsheet application read the cell as a formula.
 * TAB and CR are included because Excel strips leading whitespace before
 * deciding, so `\t=cmd…` is still a formula.
 */
const FORMULA_LEAD = /^[=+\-@\t\r]/;

/** Reserved characters that force RFC 4180 quoting. */
const NEEDS_QUOTES = /[",\r\n]/;

function stringify(value: CsvValue): string {
  if (value === null || value === undefined) return '';
  return String(value);
}

/**
 * RFC 4180 quoting, applied AFTER whatever formula decision was made.
 * `alwaysQuote` exists because one existing writer quotes every field for
 * stable diffs; quoting is orthogonal to the formula guard and never
 * substitutes for it (Excel evaluates `"=1+1"` as a formula just the same).
 */
function rfc4180(field: string, alwaysQuote: boolean): CsvCell {
  const escaped = field.replace(/"/g, '""');
  const quote = alwaysQuote || NEEDS_QUOTES.test(field);
  return (quote ? `"${escaped}"` : escaped) as CsvCell;
}

export interface CsvCellOptions {
  /** Quote every field, not only the ones that require it. Default false. */
  readonly alwaysQuote?: boolean;
}

/**
 * Encode one cell of untrusted text. This is the default and it always
 * applies the formula guard.
 */
export function csvCell(value: CsvValue, options: CsvCellOptions = {}): CsvCell {
  const text = stringify(value);
  if (text === '' ) return rfc4180('', options.alwaysQuote ?? false);
  // Leading whitespace is skipped before judging, because spreadsheet
  // applications skip it too — `"   =cmd"` is a formula to Excel.
  const firstNonSpace = text.search(/\S/);
  const judged = firstNonSpace === -1 ? text : text.slice(firstNonSpace);
  const guarded = FORMULA_LEAD.test(judged) || FORMULA_LEAD.test(text) ? `'${text}` : text;
  return rfc4180(guarded, options.alwaysQuote ?? false);
}

/**
 * Emit a cell that IS a formula, e.g. round-tripping a spreadsheet whose cell
 * carried `SUM(B1:B2)`. Pass the formula WITHOUT the leading `=`.
 *
 * This is a deliberate, named opt-out from the guard. It is safe only because
 * the caller has independent evidence that the source cell was a formula —
 * never because the text merely looks like one.
 */
export function csvFormulaCell(formula: string, options: CsvCellOptions = {}): CsvCell {
  return rfc4180(`=${formula}`, options.alwaysQuote ?? false);
}

/**
 * Emit a cell with NO formula guard. Requires a reason at the call site, as a
 * value rather than a comment, so the justification travels with the code and
 * cannot be dropped by a formatter or a careless edit.
 *
 * @param reason why this cell must not be guarded. Non-empty; enforced.
 */
export function csvVerbatimCell(
  value: CsvValue,
  reason: string,
  options: CsvCellOptions = {},
): CsvCell {
  if (reason.trim() === '') {
    throw new Error('csvVerbatimCell requires a non-empty reason');
  }
  return rfc4180(stringify(value), options.alwaysQuote ?? false);
}

/** Join encoded cells into one CSV record. */
export function csvRow(cells: readonly CsvCell[]): string {
  return cells.join(',');
}

export interface CsvDocumentOptions {
  /** Record separator. RFC 4180 says CRLF; some writers use LF. */
  readonly lineEnding?: '\r\n' | '\n';
  /** Emit a trailing separator after the last record. */
  readonly trailingNewline?: boolean;
}

/** Join encoded records into a CSV document. */
export function csvDocument(
  rows: readonly (readonly CsvCell[])[],
  options: CsvDocumentOptions = {},
): string {
  const eol = options.lineEnding ?? '\r\n';
  const body = rows.map(csvRow).join(eol);
  return options.trailingNewline ? `${body}${eol}` : body;
}

/** Convenience: encode a whole record of untrusted values with the guard on. */
export function csvGuardedRow(values: readonly CsvValue[], options: CsvCellOptions = {}): CsvCell[] {
  return values.map((value) => csvCell(value, options));
}
