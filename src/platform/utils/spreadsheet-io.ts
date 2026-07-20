// Spreadsheet IO Utilities
// Parse and serialize .xlsx, .xls, and .csv files for the SpreadsheetViewer.
//
// SheetJS variant: We install the official SheetJS CE tarball from the SheetJS
// CDN (https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz) rather than the npm
// `xlsx` package. The npm package is pinned at 0.18.5 and has known CVEs;
// SheetJS now distributes secure releases exclusively via their CDN. This is
// Apache-2.0 and safe for Lantern's commercial license.

import * as XLSX from 'xlsx';
import Papa from 'papaparse';

import { csvCell, csvDocument, csvFormulaCell, csvVerbatimCell } from '@/platform/export/csvSafe';
import {
  assertArchiveWithinBudget,
  assertInputBytesWithinCap,
  looksLikeZip,
} from '@/platform/archive/safeZip';

import {
  evaluateFormulaString,
  extractDependencies,
  formulaValueToDisplay,
  type CellLookup,
  type FormulaValue,
} from './formula-engine';

// dataUrlToArrayBuffer moved to file-utils.ts (pure base64 decoding, no `xlsx`
// dependency) so flushDirtyTabs.ts — reached from the always-eager startup
// path — doesn't drag SheetJS into the main bundle just for it. Re-exported
// here for backward compatibility with existing `spreadsheet-io` imports.
export { dataUrlToArrayBuffer } from './file-utils';
import { dataUrlToArrayBuffer } from './file-utils';

/** A merged-cell range, in SheetJS's `{ s: {r,c}, e: {r,c} }` shape. */
export interface MergeRange {
  /** Inclusive start row index (0-based). */
  startRow: number;
  /** Inclusive start column index (0-based). */
  startCol: number;
  /** Inclusive end row index (0-based). */
  endRow: number;
  /** Inclusive end column index (0-based). */
  endCol: number;
}

/** A single cell's parsed contents, ready for rendering. */
export interface SheetCell {
  /** Display value. Prefers the formatted string (`w` in SheetJS) when present
   *  so dates/currencies/percentages render the way Excel renders them. */
  display: string;
  /** Raw cell value (number, string, boolean, Date, or null). */
  raw: string | number | boolean | Date | null;
  /** Excel formula string, if the cell contains one (without leading `=`). */
  formula?: string;
}

export interface SheetData {
  /** Sheet name as it appears in Excel. */
  name: string;
  /** 2D grid of cells, indexed `[row][col]`. Empty cells are `null`. */
  rows: (SheetCell | null)[][];
  /** Merged-cell ranges declared by the workbook. */
  merges: MergeRange[];
  /** Optional column widths in characters (rough Excel-equivalent units). */
  columnWidths?: number[];
  /** Optional row heights in points. */
  rowHeights?: number[];
  /** Total column count after padding (so all rows are uniform). */
  columnCount: number;
}

export interface SheetModel {
  /** All sheets in the workbook, in workbook order. */
  sheets: SheetData[];
  /** Index of the default-active sheet. */
  activeSheetIndex: number;
  /** File extension this model came from (drives serialization). */
  sourceExtension: 'xlsx' | 'xls' | 'csv';
  /**
   * Live formula engine, seeded on parse with every cell + formula in the
   * workbook. Consumers update cells through `engine.updateCell()` so that
   * dependent formulas recompute on edit instead of showing stale cached
   * values from the original xlsx file. Undefined when no cells contain
   * formulas (single-sheet CSVs mostly).
   */
  engine?: SheetEngine;
}

export type SpreadsheetExtension = 'xlsx' | 'xls' | 'csv';

// ---------------------------------------------------------------------------
// SheetEngine — dependency-tracking formula recomputation
// ---------------------------------------------------------------------------

/**
 * Per-sheet formula engine. Indexed by `${row}:${col}` keys across a single
 * `SheetData` (cross-sheet refs are not supported yet — they evaluate to
 * `#REF!`). The engine stores:
 *   - `values`:  the current (possibly-recomputed) value of every cell
 *   - `formulas`: the formula string attached to cells that have one
 *   - `dependents`: reverse graph — for each cell, which formula cells
 *                    depend on it (so we can walk down on edit)
 */
export class SheetEngine {
  private values = new Map<string, FormulaValue>();
  private formulas = new Map<string, string>();
  /** cellKey -> set of cellKeys that reference it (via formulas). */
  private dependents = new Map<string, Set<string>>();

  constructor(sheet: SheetData) {
    this.seed(sheet);
  }

  private static key(row: number, col: number): string {
    return `${row}:${col}`;
  }

  /** Seed all cells, then recompute formulas so `values` carries live
   *  (not SheetJS-cached) results. */
  private seed(sheet: SheetData) {
    for (let r = 0; r < sheet.rows.length; r++) {
      const row = sheet.rows[r];
      if (!row) continue;
      for (let c = 0; c < row.length; c++) {
        const cell = row[c];
        if (!cell) continue;
        const k = SheetEngine.key(r, c);
        if (cell.formula) {
          this.formulas.set(k, cell.formula);
          // Record dependencies
          const deps = extractDependencies(cell.formula);
          for (const dep of deps) {
            const depKey = SheetEngine.key(dep.row, dep.col);
            let set = this.dependents.get(depKey);
            if (!set) {
              set = new Set();
              this.dependents.set(depKey, set);
            }
            set.add(k);
          }
          // Placeholder value — will be recomputed below.
          this.values.set(k, null);
        } else {
          this.values.set(k, cell.raw as FormulaValue);
        }
      }
    }

    // Evaluate every formula cell once, in no particular order. A dependency
    // may itself be a formula; the engine handles that recursively via the
    // lookup callback, which falls back to the cached cell if the dependency
    // hasn't been computed yet. On edit, the incremental recompute path
    // walks the dependents set so order doesn't matter there either.
    const visiting = new Set<string>();
    for (const [k] of this.formulas) {
      this.evaluateKey(k, visiting);
    }
  }

  private lookup: CellLookup = (row, col) => {
    const k = SheetEngine.key(row, col);
    return this.values.get(k) ?? null;
  };

  /** Evaluate a single formula cell and store the result. */
  private evaluateKey(k: string, visiting: Set<string>): FormulaValue {
    const formula = this.formulas.get(k);
    if (formula === undefined) return this.values.get(k) ?? null;

    if (visiting.has(k)) {
      // Circular reference — Excel shows #CIRC! / #REF! here.
      this.values.set(k, '#CIRC!');
      return '#CIRC!';
    }
    visiting.add(k);
    let result: FormulaValue;
    try {
      // Resolve dependencies first so they carry fresh values.
      const deps = extractDependencies(formula);
      for (const dep of deps) {
        const depKey = SheetEngine.key(dep.row, dep.col);
        if (this.formulas.has(depKey)) {
          this.evaluateKey(depKey, visiting);
        }
      }
      result = evaluateFormulaString(formula, this.lookup);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '#ERROR!';
      result = msg.startsWith('#') ? msg : '#ERROR!';
    }
    visiting.delete(k);
    this.values.set(k, result);
    return result;
  }

  /** Return the display string for a cell (formula cells show the computed
   *  value, plain cells return their own display). */
  public getDisplay(row: number, col: number): string | null {
    const k = SheetEngine.key(row, col);
    if (this.formulas.has(k)) {
      return formulaValueToDisplay(this.values.get(k) ?? null);
    }
    return null;
  }

  public getFormula(row: number, col: number): string | undefined {
    return this.formulas.get(SheetEngine.key(row, col));
  }

  /**
   * Apply an edit to a single cell and return the set of cells that changed
   * (the edit itself plus every formula cell that transitively depends on
   * it). The caller repaints those cells in the grid.
   */
  public updateCell(
    row: number,
    col: number,
    next: { raw: FormulaValue; formula?: string }
  ): Array<{ row: number; col: number; display: string }> {
    const k = SheetEngine.key(row, col);

    // Tear down old dependencies for this cell so the graph stays accurate.
    const oldFormula = this.formulas.get(k);
    if (oldFormula) {
      const oldDeps = extractDependencies(oldFormula);
      for (const dep of oldDeps) {
        this.dependents.get(SheetEngine.key(dep.row, dep.col))?.delete(k);
      }
      this.formulas.delete(k);
    }

    // Apply the new content.
    if (next.formula) {
      this.formulas.set(k, next.formula);
      const newDeps = extractDependencies(next.formula);
      for (const dep of newDeps) {
        const depKey = SheetEngine.key(dep.row, dep.col);
        let set = this.dependents.get(depKey);
        if (!set) {
          set = new Set();
          this.dependents.set(depKey, set);
        }
        set.add(k);
      }
      this.evaluateKey(k, new Set());
    } else {
      this.values.set(k, next.raw);
    }

    // Collect this cell + all transitive dependents, in BFS order so each
    // one sees up-to-date values from the ones above it in the graph.
    const touched = new Set<string>([k]);
    const queue: string[] = [k];
    while (queue.length > 0) {
      const current = queue.shift()!;
      const deps = this.dependents.get(current);
      if (!deps) continue;
      for (const d of deps) {
        if (touched.has(d)) continue;
        touched.add(d);
        queue.push(d);
      }
    }

    // Recompute every formula cell in the touched set. We iterate in the
    // order they were discovered by BFS, which guarantees an edit's direct
    // dependents get fresh values before their own dependents do.
    const visiting = new Set<string>();
    const orderedKeys = Array.from(touched);
    for (const tk of orderedKeys) {
      if (this.formulas.has(tk)) {
        this.evaluateKey(tk, visiting);
      }
    }

    // Build the patch list for the UI.
    const patch: Array<{ row: number; col: number; display: string }> = [];
    for (const tk of orderedKeys) {
      const [rStr, cStr] = tk.split(':');
      const r = Number(rStr);
      const c = Number(cStr);
      if (!Number.isFinite(r) || !Number.isFinite(c)) continue;
      const val = this.values.get(tk) ?? null;
      const displayStr = this.formulas.has(tk)
        ? formulaValueToDisplay(val)
        : val === null
        ? ''
        : String(val);
      patch.push({ row: r, col: c, display: displayStr });
    }
    return patch;
  }

  /** Snapshot the engine's current values onto the underlying SheetData so
   *  the model serializes with fresh formula outputs (cached `display` +
   *  `raw`), matching what the user sees. */
  public snapshotInto(sheet: SheetData) {
    for (const [k] of this.formulas) {
      const [rStr, cStr] = k.split(':');
      const r = Number(rStr);
      const c = Number(cStr);
      if (!Number.isFinite(r) || !Number.isFinite(c)) continue;
      const row = sheet.rows[r];
      if (!row) continue;
      const cell = row[c];
      if (!cell) continue;
      const val = this.values.get(k) ?? null;
      cell.display = formulaValueToDisplay(val);
      if (typeof val === 'number' || typeof val === 'boolean') {
        cell.raw = val;
      } else if (val === null) {
        cell.raw = null;
      } else {
        cell.raw = String(val);
      }
    }
  }
}

/**
 * Heuristic: does `source` look like a data URL (base64-encoded) vs raw
 * text? Data URLs always start with `data:`. Anything else — including raw
 * CSV text that happens to contain commas or quotes — is treated as a text
 * payload.
 */
function isDataUrl(source: string): boolean {
  return source.startsWith('data:');
}

/**
 * Parse a spreadsheet from either a data URL, raw text (CSV only), or an
 * ArrayBuffer. Routes to SheetJS for `.xlsx`/`.xls` and PapaParse for
 * `.csv`.
 *
 * UX-32: CSVs are often written to disk as plain text (isBinaryFile('.csv')
 * is false, so writeDroppedFiles uses writeFile(content) with raw text
 * content). When the viewer later reads them back, the `src` is raw text —
 * NOT a `data:` URL. Calling atob on raw CSV (e.g. `a,b,c\n1,2,3`) blows up
 * with "not correctly encoded". Detect raw text vs data URL and branch.
 *
 * Side-effect: if any sheet contains formulas, a `SheetEngine` is attached
 * to `model.engine` and every formula cell's `display` is overwritten with
 * the engine's live-computed value. This corrects the common case where
 * SheetJS's cached display (`w`) is stale or missing.
 */
export async function parseSpreadsheet(
  source: string | ArrayBuffer,
  extension: SpreadsheetExtension
): Promise<SheetModel> {
  let buffer: ArrayBuffer;
  if (typeof source !== 'string') {
    buffer = source;
  } else if (isDataUrl(source)) {
    buffer = dataUrlToArrayBuffer(source);
  } else if (extension === 'csv') {
    // Raw CSV text — encode to bytes so parseCsv can treat it uniformly.
    buffer = new TextEncoder().encode(source).buffer as ArrayBuffer;
  } else {
    // xlsx/xls should never arrive as raw text; the only consumers are
    // binary data URLs or the file reader. Fall back to TextEncoder so we
    // fail with a parse error rather than atob's cryptic message.
    buffer = new TextEncoder().encode(source).buffer as ArrayBuffer;
  }

  // R-17 — an `.xlsx` IS a zip. `XLSX.read` unzips it inside SheetJS, out of
  // our sight, which is why a JSZip-shaped search for "archive readers" never
  // saw this line. The pre-flight refuses a declared bomb before SheetJS gets
  // the bytes; see `safeZip.ts` for why that is weaker than the metered read
  // and what the complete version is. `.xls` is not a zip but the input-size
  // cap still applies, so it goes through the same door — but as a size cap
  // only, because a BIFF file has no central directory and pretending to read
  // one would be a guard that reports on something it cannot see.
  if (extension !== 'csv') {
    const label = `spreadsheet .${extension}`;
    if (looksLikeZip(buffer)) {
      await assertArchiveWithinBudget(buffer, label);
    } else {
      assertInputBytesWithinCap(buffer, label);
    }
  }

  const model = extension === 'csv' ? parseCsv(buffer) : parseXlsx(buffer, extension);

  // Wire the formula engine for the active sheet. Only one engine per
  // workbook for now — cross-sheet references aren't supported, and users
  // typically edit one sheet at a time anyway.
  const activeSheet = model.sheets[model.activeSheetIndex] ?? model.sheets[0];
  if (activeSheet) {
    const hasFormulas = activeSheet.rows.some((row) => row.some((cell) => cell?.formula));
    if (hasFormulas) {
      const engine = new SheetEngine(activeSheet);
      // Overlay live-computed values on the model so first paint shows the
      // right thing, not SheetJS's cached value (which may be stale).
      for (let r = 0; r < activeSheet.rows.length; r++) {
        const row = activeSheet.rows[r];
        if (!row) continue;
        for (let c = 0; c < row.length; c++) {
          const cell = row[c];
          if (!cell?.formula) continue;
          const live = engine.getDisplay(r, c);
          if (live !== null) cell.display = live;
        }
      }
      model.engine = engine;
    }
  }

  return model;
}

/**
 * Serialize a `SheetModel` back into a binary representation suitable for
 * writing to disk. Routes to SheetJS for xlsx/xls and PapaParse for csv.
 *
 * Formulas: cells whose `formula` field is set are preserved as formulas in
 * the output workbook. SheetJS will evaluate them to cached values when
 * another program opens the file — it does not compute formulas itself, so
 * the cell's `display` value is stored as the cached value alongside.
 */
export function serializeSpreadsheet(
  model: SheetModel,
  extension: SpreadsheetExtension
): Uint8Array {
  if (extension === 'csv') {
    return serializeCsv(model);
  }
  return serializeXlsx(model, extension);
}

function serializeXlsx(model: SheetModel, extension: 'xlsx' | 'xls'): Uint8Array {
  const wb = XLSX.utils.book_new();

  for (const sheet of model.sheets) {
    const ws: XLSX.WorkSheet = {};

    // Determine dimensions from the widest row; empty sheets still need a `!ref`.
    const rowCount = sheet.rows.length;
    const colCount = sheet.rows.reduce((max, row) => Math.max(max, row.length), 0) || sheet.columnCount;

    for (let r = 0; r < rowCount; r++) {
      const row = sheet.rows[r] ?? [];
      for (let c = 0; c < colCount; c++) {
        const cell = row[c];
        if (!cell) continue;
        const addr = XLSX.utils.encode_cell({ r, c });
        ws[addr] = sheetCellToXlsxCell(cell);
      }
    }

    if (rowCount === 0 || colCount === 0) {
      ws['!ref'] = 'A1:A1';
    } else {
      ws['!ref'] = XLSX.utils.encode_range({
        s: { r: 0, c: 0 },
        e: { r: Math.max(rowCount - 1, 0), c: Math.max(colCount - 1, 0) },
      });
    }

    if (sheet.merges.length > 0) {
      ws['!merges'] = sheet.merges.map((m) => ({
        s: { r: m.startRow, c: m.startCol },
        e: { r: m.endRow, c: m.endCol },
      }));
    }

    if (sheet.columnWidths && sheet.columnWidths.length > 0) {
      ws['!cols'] = sheet.columnWidths.map((wch) => ({ wch }));
    }
    if (sheet.rowHeights && sheet.rowHeights.length > 0) {
      ws['!rows'] = sheet.rowHeights.map((hpt) => ({ hpt }));
    }

    XLSX.utils.book_append_sheet(wb, ws, sheet.name);
  }

  // XLSX.write returns an ArrayBuffer when `type: 'array'`. Wrap in Uint8Array
  // so callers get the same shape regardless of the target extension.
  const written = XLSX.write(wb, {
    bookType: extension,
    type: 'array',
  }) as ArrayBuffer;
  return new Uint8Array(written);
}

/**
 * Convert a SheetCell into the XLSX cell object SheetJS expects.
 * - Formulas carry the `f` string; cached value stored alongside.
 * - Plain values pick the right `t` (type) based on the raw typeof.
 */
function sheetCellToXlsxCell(cell: SheetCell): XLSX.CellObject {
  const out: XLSX.CellObject = { t: 's', v: '' };

  if (cell.formula && cell.formula.length > 0) {
    // SheetJS uses `f` without the leading `=`.
    out.f = cell.formula;
    // Stash cached value + type so other readers see the same value we showed.
    if (typeof cell.raw === 'number') {
      out.t = 'n';
      out.v = cell.raw;
    } else if (typeof cell.raw === 'boolean') {
      out.t = 'b';
      out.v = cell.raw;
    } else if (cell.raw instanceof Date) {
      out.t = 'd';
      out.v = cell.raw;
    } else if (cell.raw == null) {
      out.t = 's';
      out.v = cell.display ?? '';
    } else {
      out.t = 's';
      out.v = String(cell.raw);
    }
    return out;
  }

  if (cell.raw == null) {
    // Null cells shouldn't have been stored — treat as empty string.
    out.t = 's';
    out.v = cell.display ?? '';
    return out;
  }

  if (typeof cell.raw === 'number') {
    out.t = 'n';
    out.v = cell.raw;
  } else if (typeof cell.raw === 'boolean') {
    out.t = 'b';
    out.v = cell.raw;
  } else if (cell.raw instanceof Date) {
    out.t = 'd';
    out.v = cell.raw;
  } else {
    out.t = 's';
    out.v = String(cell.raw);
  }
  return out;
}

/**
 * R-16 — the sixth CSV writer.
 *
 * The old body had two branches. The FORMULA branch was deliberate and stayed
 * deliberate: a cell that carried `SUM(B1:B2)` is written back as `=SUM(B1:B2)`
 * so re-opening in Excel gives the user their formula. The NON-FORMULA branch
 * wrote `cell.display` straight out.
 *
 * That branch is a privilege elevation across a format conversion. Open an
 * `.xlsx` whose text cell contains `=cmd|'/c calc'!A1` — SheetJS gives that
 * cell NO `.f`, because in the workbook it is inert text — then Save As `.csv`.
 * The old code took the non-formula branch and wrote the payload with no
 * prefix, and CSV has no notion of "text that looks like a formula": the next
 * program to open the file executes it. Text went in, a formula came out.
 *
 * The fix is not a local `if`. Every cell now leaves through one of three
 * NAMED doors in `@/platform/export/csvSafe`, and the default door is guarded:
 *
 *   formula set          -> csvFormulaCell   (it IS a formula; say so)
 *   source was a .csv    -> csvVerbatimCell  (round-trip; reason required)
 *   everything else      -> csvCell          (guarded)
 *
 * The middle door needs its reason stated, because it is the one that looks
 * like a hole: a `.csv` cell whose text starts with `=` was ALREADY a live
 * formula in the file the user opened — Excel would have executed it there.
 * Re-emitting it verbatim preserves the user's document; guarding it would
 * silently rewrite a file we were only asked to save. Nothing is elevated,
 * because nothing was inert to begin with. The elevation case — inert xlsx
 * text becoming a csv formula — cannot reach this door, because its model's
 * `sourceExtension` is `xlsx`/`xls`.
 */
function serializeCsv(model: SheetModel): Uint8Array {
  // CSVs carry a single sheet (PapaParse has no concept of tabs). Prefer the
  // active sheet; fall back to the first sheet if no active is set.
  const sheet = model.sheets[model.activeSheetIndex] ?? model.sheets[0];
  if (!sheet) {
    return new TextEncoder().encode('');
  }

  const roundTrippingACsv = model.sourceExtension === 'csv';

  const rows = sheet.rows.map((row) =>
    row.map((cell) => {
      if (!cell) return csvCell('');
      if (cell.formula) return csvFormulaCell(cell.formula);
      const text = cell.display ?? '';
      if (roundTrippingACsv) {
        return csvVerbatimCell(
          text,
          'csv→csv round-trip: a leading "=" in the source CSV was already a live ' +
            'formula there, so preserving it changes nothing and guarding it would ' +
            'rewrite the user’s file',
        );
      }
      return csvCell(text);
    })
  );

  // PapaParse's own quoting is not used any more: it has no opinion about
  // formulas, and running it AFTER csvSafe would double-quote already-encoded
  // fields. csvDocument does the RFC 4180 join.
  const csv = csvDocument(rows, { lineEnding: '\r\n' });
  // UTF-8 bytes for the whole string, newline-terminated so Excel is happy.
  return new TextEncoder().encode(`${csv}\n`);
}

/**
 * Bundle a serialized spreadsheet back into a data URL suitable for storage
 * in the editor tab's `content` field. MIME type must match the extension.
 */
export function spreadsheetBytesToDataUrl(
  bytes: Uint8Array,
  extension: SpreadsheetExtension
): string {
  const mime = spreadsheetMimeType(extension);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i] as number);
  }
  return `data:${mime};base64,${btoa(binary)}`;
}

function spreadsheetMimeType(extension: SpreadsheetExtension): string {
  switch (extension) {
    case 'xlsx':
      return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    case 'xls':
      return 'application/vnd.ms-excel';
    case 'csv':
      return 'text/csv';
  }
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function parseXlsx(buffer: ArrayBuffer, extension: 'xlsx' | 'xls'): SheetModel {
  const workbook = XLSX.read(buffer, {
    type: 'array',
    cellDates: true,
    cellFormula: true,
    cellNF: true, // keep number-format strings so `w` is populated for typed cells
    // F-506: surface formula cells whose cached value is empty (openpyxl-
    // class writers emit `<f>…</f><v></v>`); without this SheetJS drops the
    // cell entirely, the formula never renders, and a save destroys it.
    sheetStubs: true,
  });

  const sheets: SheetData[] = workbook.SheetNames.map((sheetName) => {
    const worksheet = workbook.Sheets[sheetName];
    if (!worksheet) {
      return emptySheet(sheetName);
    }
    return parseWorksheet(sheetName, worksheet);
  });

  return {
    sheets,
    activeSheetIndex: 0,
    sourceExtension: extension,
  };
}

function parseWorksheet(name: string, worksheet: XLSX.WorkSheet): SheetData {
  // `!ref` is the workbook's declared occupied range, e.g. "A1:F50".
  // Falling back to A1:A1 keeps indexing safe for empty sheets.
  const ref = worksheet['!ref'] ?? 'A1:A1';
  const range = XLSX.utils.decode_range(ref);

  const rowCount = Math.max(range.e.r - range.s.r + 1, 0);
  const colCount = Math.max(range.e.c - range.s.c + 1, 0);

  const rows: (SheetCell | null)[][] = [];
  for (let r = 0; r < rowCount; r++) {
    const row: (SheetCell | null)[] = [];
    for (let c = 0; c < colCount; c++) {
      const cellAddr = XLSX.utils.encode_cell({ r: range.s.r + r, c: range.s.c + c });
      const cell = worksheet[cellAddr] as XLSX.CellObject | undefined;
      row.push(cellToSheetCell(cell));
    }
    rows.push(row);
  }

  const merges: MergeRange[] = (worksheet['!merges'] ?? []).map((m) => ({
    startRow: m.s.r - range.s.r,
    startCol: m.s.c - range.s.c,
    endRow: m.e.r - range.s.r,
    endCol: m.e.c - range.s.c,
  }));

  // Column widths: SheetJS exposes `!cols` with optional `wch` (width in chars).
  const cols = worksheet['!cols'];
  const columnWidths: number[] | undefined = cols
    ? cols.slice(0, colCount).map((col) => col?.wch ?? col?.wpx ?? 10)
    : undefined;

  // Row heights: `!rows` with optional `hpt` (height in points).
  const rowsMeta = worksheet['!rows'];
  const rowHeights: number[] | undefined = rowsMeta
    ? rowsMeta.slice(0, rowCount).map((row) => row?.hpt ?? 15)
    : undefined;

  const sheet: SheetData = {
    name,
    rows,
    merges,
    columnCount: colCount,
  };
  if (columnWidths) {
    sheet.columnWidths = columnWidths;
  }
  if (rowHeights) {
    sheet.rowHeights = rowHeights;
  }
  return sheet;
}

function cellToSheetCell(cell: XLSX.CellObject | undefined): SheetCell | null {
  if (!cell) return null;

  // F-506: with `sheetStubs: true`, blank cells arrive as `{t:'z'}` stubs.
  // A stub WITH a formula is a real formula cell whose author cached no
  // value — keep it so `hasFormulas` trips and the engine computes it live.
  // A stub WITHOUT a formula is genuinely blank — drop it so the model and
  // serializeXlsx don't bloat with empty cells.
  if (cell.t === 'z' && !cell.f) return null;

  // Prefer the formatted display string (`w`) when SheetJS computed one —
  // this is what Excel shows after applying the number format.
  const display =
    typeof cell.w === 'string' && cell.w.length > 0
      ? cell.w
      : cell.v == null
      ? ''
      : String(cell.v);

  let raw: SheetCell['raw'];
  if (cell.v == null) {
    raw = null;
  } else if (cell.v instanceof Date) {
    raw = cell.v;
  } else if (typeof cell.v === 'number' || typeof cell.v === 'string' || typeof cell.v === 'boolean') {
    raw = cell.v;
  } else {
    raw = String(cell.v);
  }

  const sheetCell: SheetCell = { display, raw };
  if (cell.f) {
    sheetCell.formula = cell.f;
  }
  return sheetCell;
}

function emptySheet(name: string): SheetData {
  return { name, rows: [], merges: [], columnCount: 0 };
}

function parseCsv(buffer: ArrayBuffer): SheetModel {
  // PapaParse handles UTF-8 text natively; decode bytes first.
  const text = new TextDecoder('utf-8').decode(buffer);

  const result = Papa.parse<string[]>(text, {
    skipEmptyLines: false,
    // Leave fields as strings — CSV has no native types and consumers can
    // coerce later if they need to. This matches Excel's "open CSV" default.
    dynamicTyping: false,
  });

  const dataRows = result.data;
  const colCount = dataRows.reduce((max, row) => Math.max(max, row.length), 0);

  const rows: (SheetCell | null)[][] = dataRows.map((rawRow) => {
    const row: (SheetCell | null)[] = [];
    for (let c = 0; c < colCount; c++) {
      const value = rawRow[c];
      if (value === undefined || value === '') {
        row.push(null);
      } else {
        row.push({ display: value, raw: value });
      }
    }
    return row;
  });

  return {
    sheets: [
      {
        name: 'Sheet1',
        rows,
        merges: [],
        columnCount: colCount,
      },
    ],
    activeSheetIndex: 0,
    sourceExtension: 'csv',
  };
}

/**
 * Create a blank spreadsheet of the given extension.
 *
 * For `.xlsx` / `.xls`, this returns a workbook with a single empty sheet
 * named `Sheet1`, sized 10 columns × 20 rows of empty strings. That gives
 * users a visible grid to start typing into without having to think about
 * adding rows or columns.
 *
 * For `.csv`, we can't store multiple rows/cells in a useful empty layout,
 * so we just return a single newline byte. This keeps the file non-zero
 * (some OS file explorers and editors get confused by empty files) while
 * keeping the viewer visually empty.
 */
export function createBlankSpreadsheet(extension: SpreadsheetExtension): Uint8Array {
  if (extension === 'csv') {
    // Single newline so the file is non-empty but the viewer shows a blank grid.
    return new TextEncoder().encode('\n');
  }

  // Build a 10-column × 20-row empty grid as the starting canvas.
  const COLS = 10;
  const ROWS = 20;
  const rows: (SheetCell | null)[][] = [];
  for (let r = 0; r < ROWS; r++) {
    const row: (SheetCell | null)[] = [];
    for (let c = 0; c < COLS; c++) {
      // Null cells keep serialization tight — SheetJS will write nothing for
      // them but the `!ref` range still reports A1:J20 so the viewer renders
      // the full grid.
      row.push(null);
    }
    rows.push(row);
  }

  const model: SheetModel = {
    sheets: [
      {
        name: 'Sheet1',
        rows,
        merges: [],
        columnCount: COLS,
      },
    ],
    activeSheetIndex: 0,
    sourceExtension: extension,
  };

  // serializeXlsx only writes cells that are present, but the !ref range is
  // computed from sheet.rows dimensions, so the grid size will be encoded even
  // though all cells are null. We force a single empty string at A1 so
  // SheetJS emits the sheet-data section; otherwise some readers (including
  // SheetJS itself) treat it as a zero-cell sheet and display just "A1".
  const sheet = model.sheets[0];
  if (sheet) {
    const firstRow = sheet.rows[0];
    if (firstRow) {
      firstRow[0] = { display: '', raw: '' };
    }
  }

  return serializeSpreadsheet(model, extension);
}

/**
 * Convert a 0-based column index to its Excel letter representation:
 * 0 → "A", 25 → "Z", 26 → "AA", 701 → "ZZ", 702 → "AAA".
 */
export function columnIndexToLetter(index: number): string {
  let n = index;
  let result = '';
  while (n >= 0) {
    result = String.fromCharCode((n % 26) + 65) + result;
    n = Math.floor(n / 26) - 1;
  }
  return result;
}
