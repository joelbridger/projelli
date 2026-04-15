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
 * Stub for serialization (Phase 3 / edit path).
 * Phase 1 is read-only; the signature exists so the call site can stabilize.
 */
export function serializeSpreadsheet(
  _model: SheetModel,
  _extension: SpreadsheetExtension
): Uint8Array {
  throw new Error(
    'serializeSpreadsheet is not implemented yet — comes online with the edit path in a later phase.'
  );
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
