// Spreadsheet IO Utilities
// Parse and serialize .xlsx, .xls, and .csv files for the SpreadsheetViewer.
//
// SheetJS variant: We install the official SheetJS CE tarball from the SheetJS
// CDN (https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz) rather than the npm
// `xlsx` package. The npm package is pinned at 0.18.5 and has known CVEs;
// SheetJS now distributes secure releases exclusively via their CDN. This is
// Apache-2.0 and safe for Projelli's commercial license.

import * as XLSX from 'xlsx';
import Papa from 'papaparse';

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
}

export type SpreadsheetExtension = 'xlsx' | 'xls' | 'csv';

/**
 * Convert a data URL to an ArrayBuffer.
 * Used internally by `parseSpreadsheet` when given a data URL.
 */
export function dataUrlToArrayBuffer(dataUrl: string): ArrayBuffer {
  const commaIndex = dataUrl.indexOf(',');
  if (commaIndex === -1) {
    throw new Error('Invalid data URL: missing comma separator.');
  }
  const base64 = dataUrl.slice(commaIndex + 1);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

/**
 * Parse a spreadsheet from either a data URL or an ArrayBuffer.
 * Routes to SheetJS for `.xlsx`/`.xls` and PapaParse for `.csv`.
 */
export async function parseSpreadsheet(
  source: string | ArrayBuffer,
  extension: SpreadsheetExtension
): Promise<SheetModel> {
  const buffer = typeof source === 'string' ? dataUrlToArrayBuffer(source) : source;

  if (extension === 'csv') {
    return parseCsv(buffer);
  }
  return parseXlsx(buffer, extension);
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

function serializeCsv(model: SheetModel): Uint8Array {
  // CSVs carry a single sheet (PapaParse has no concept of tabs). Prefer the
  // active sheet; fall back to the first sheet if no active is set.
  const sheet = model.sheets[model.activeSheetIndex] ?? model.sheets[0];
  if (!sheet) {
    return new TextEncoder().encode('');
  }

  const rows: string[][] = sheet.rows.map((row) =>
    row.map((cell) => {
      if (!cell) return '';
      if (cell.formula) {
        // CSV can't carry formulas — preserve the `=` prefix so re-opening
        // in Excel re-interprets it as a formula.
        return `=${cell.formula}`;
      }
      return cell.display ?? '';
    })
  );

  const csv = Papa.unparse(rows);
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
