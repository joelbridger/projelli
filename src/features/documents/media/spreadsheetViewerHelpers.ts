// Pure leaf helpers, layout constants + shared types extracted from
// SpreadsheetViewer.tsx (behavior-preserving 3.0 reorg). Cell-position /
// merge types, virtualizer/layout constants, and pure model-editing
// functions (clone, set-cell, insert/delete row+col, auto-width, navigation,
// extension inference). No React / component dependencies.

import { SheetEngine } from '@/utils/spreadsheet-io';
import type {
  SheetModel,
  SheetData,
  SheetCell,
  MergeRange,
  SpreadsheetExtension,
} from '@/utils/spreadsheet-io';

/** Anything more than this row count flips on the virtualizer. */
export const VIRTUALIZE_ROW_THRESHOLD = 500;

/** Visual constants — kept local so the grid stays Excel-like and the
 *  virtualizer's row-height estimator stays accurate. */
export const ROW_HEIGHT_PX = 24;
export const ROW_HEADER_WIDTH_PX = 48;
export const DEFAULT_COL_WIDTH_PX = 96;

export interface CellPos {
  row: number;
  col: number;
}

// ---------------------------------------------------------------------------
// Merge bookkeeping
// ---------------------------------------------------------------------------

export interface MergeMaps {
  /** Cells that should NOT render — they're covered by a merge from above/left. */
  skip: Set<string>;
  /** Cells that ARE the top-left origin of a merge — render with span. */
  origin: Map<string, MergeRange>;
}

export function buildMergeMaps(merges: MergeRange[]): MergeMaps {
  const skip = new Set<string>();
  const origin = new Map<string, MergeRange>();

  for (const merge of merges) {
    origin.set(`${merge.startRow}:${merge.startCol}`, merge);
    for (let r = merge.startRow; r <= merge.endRow; r++) {
      for (let c = merge.startCol; c <= merge.endCol; c++) {
        if (r === merge.startRow && c === merge.startCol) continue;
        skip.add(`${r}:${c}`);
      }
    }
  }

  return { skip, origin };
}

// ---------------------------------------------------------------------------
// Model editing helpers (pure functions — no React state)
// ---------------------------------------------------------------------------

export function cloneSheet(sheet: SheetData): SheetData {
  const cloned: SheetData = {
    name: sheet.name,
    rows: sheet.rows.map((row) => row.map((cell) => (cell ? { ...cell } : null))),
    merges: sheet.merges.map((m) => ({ ...m })),
    columnCount: sheet.columnCount,
  };
  if (sheet.columnWidths) cloned.columnWidths = [...sheet.columnWidths];
  if (sheet.rowHeights) cloned.rowHeights = [...sheet.rowHeights];
  return cloned;
}

export function cloneModel(model: SheetModel): SheetModel {
  const next: SheetModel = {
    sheets: model.sheets.map(cloneSheet),
    activeSheetIndex: model.activeSheetIndex,
    sourceExtension: model.sourceExtension,
  };
  // Carry the engine forward — it tracks live values across edits. The
  // engine references the ORIGINAL sheet, so callers that mutate structure
  // (row/col insert/delete) must rebuild it via `new SheetEngine(sheet)`.
  if (model.engine) next.engine = model.engine;
  return next;
}

export function valueToCell(value: string): SheetCell | null {
  if (value === '') return null;
  if (value.startsWith('=')) {
    // Store as formula — leading `=` is stripped for SheetJS's `f` field.
    const formula = value.slice(1);
    return {
      display: value, // keep `=FORMULA` in display until SheetJS recomputes
      raw: null,
      formula,
    };
  }
  // Try to coerce to a number for typed storage. Excel would do the same.
  const num = Number(value);
  if (!Number.isNaN(num) && value.trim() !== '' && /^-?\d+(\.\d+)?$/.test(value.trim())) {
    return { display: value, raw: num };
  }
  return { display: value, raw: value };
}

export function setCellValue(
  model: SheetModel,
  sheetIndex: number,
  pos: CellPos,
  value: string
): SheetModel {
  const next = cloneModel(model);
  const sheet = next.sheets[sheetIndex];
  if (!sheet) return next;

  // Ensure the row exists and is padded to the sheet's column count.
  while (sheet.rows.length <= pos.row) {
    sheet.rows.push(new Array(sheet.columnCount).fill(null));
  }
  const row = sheet.rows[pos.row];
  if (!row) return next;
  while (row.length <= pos.col) {
    row.push(null);
  }
  const newCell = valueToCell(value);
  row[pos.col] = newCell;

  sheet.columnCount = Math.max(sheet.columnCount, pos.col + 1);

  // If the workbook has a live engine and we're editing the active sheet,
  // tell the engine about the edit so any dependent formula cells get
  // recomputed. The engine returns a patch list — apply each patch back
  // onto the cloned sheet so the UI renders fresh values.
  if (next.engine && sheetIndex === next.activeSheetIndex) {
    let rawValue: number | string | boolean | null;
    let formulaStr: string | undefined;
    if (newCell) {
      formulaStr = newCell.formula;
      if (newCell.raw === null || newCell.raw instanceof Date) {
        rawValue = newCell.raw === null ? null : newCell.raw.toISOString();
      } else {
        rawValue = newCell.raw;
      }
    } else {
      rawValue = null;
    }
    const patch = next.engine.updateCell(pos.row, pos.col, {
      raw: rawValue,
      ...(formulaStr !== undefined ? { formula: formulaStr } : {}),
    });
    for (const p of patch) {
      // Skip the edited cell itself — its display is already set by
      // valueToCell above, which shows `=FORMULA` literally until the
      // engine's result arrives below (then we overwrite for formula cells).
      const dependentRow = sheet.rows[p.row];
      if (!dependentRow) continue;
      const existing = dependentRow[p.col];
      if (!existing) continue;
      // Only overwrite display — keep raw/formula as-is. For formula cells,
      // also fold the engine's computed value into `raw` so round-tripped
      // cached values are live.
      existing.display = p.display;
      if (existing.formula) {
        const asNum = Number(p.display);
        if (!Number.isNaN(asNum) && p.display.trim() !== '') {
          existing.raw = asNum;
        } else if (p.display.startsWith('#')) {
          existing.raw = p.display;
        } else {
          existing.raw = p.display;
        }
      }
    }
  }

  return next;
}

export function insertRow(
  model: SheetModel,
  sheetIndex: number,
  selected: CellPos | null,
  where: 'above' | 'below'
): SheetModel {
  if (!selected) return model;
  const next = cloneModel(model);
  const sheet = next.sheets[sheetIndex];
  if (!sheet) return next;
  const insertAt = where === 'above' ? selected.row : selected.row + 1;
  const blankRow: (SheetCell | null)[] = new Array(sheet.columnCount).fill(null);
  sheet.rows.splice(insertAt, 0, blankRow);

  // Shift merges that start at or after the insertion point.
  sheet.merges = sheet.merges.map((m) => {
    if (m.startRow >= insertAt) {
      return { ...m, startRow: m.startRow + 1, endRow: m.endRow + 1 };
    }
    if (m.endRow >= insertAt) {
      return { ...m, endRow: m.endRow + 1 };
    }
    return m;
  });

  // Rebuild the engine — row indices shifted so formula references to rows
  // at or below the insertion point would be off by one. Simplest correct
  // behavior is a fresh build from the new SheetData.
  if (sheetIndex === next.activeSheetIndex) {
    next.engine = new SheetEngine(sheet);
  } else if (next.engine === undefined) {
    delete next.engine;
  }
  return next;
}

export function insertCol(
  model: SheetModel,
  sheetIndex: number,
  selected: CellPos | null,
  where: 'left' | 'right'
): SheetModel {
  if (!selected) return model;
  const next = cloneModel(model);
  const sheet = next.sheets[sheetIndex];
  if (!sheet) return next;
  const insertAt = where === 'left' ? selected.col : selected.col + 1;

  for (const row of sheet.rows) {
    row.splice(insertAt, 0, null);
  }
  sheet.columnCount += 1;
  if (sheet.columnWidths) {
    sheet.columnWidths.splice(insertAt, 0, 10);
  }

  sheet.merges = sheet.merges.map((m) => {
    if (m.startCol >= insertAt) {
      return { ...m, startCol: m.startCol + 1, endCol: m.endCol + 1 };
    }
    if (m.endCol >= insertAt) {
      return { ...m, endCol: m.endCol + 1 };
    }
    return m;
  });

  if (sheetIndex === next.activeSheetIndex) {
    next.engine = new SheetEngine(sheet);
  } else if (next.engine === undefined) {
    delete next.engine;
  }
  return next;
}

export function deleteRow(
  model: SheetModel,
  sheetIndex: number,
  selected: CellPos | null
): SheetModel | null {
  if (!selected) return null;
  const next = cloneModel(model);
  const sheet = next.sheets[sheetIndex];
  if (!sheet || sheet.rows.length === 0) return null;
  sheet.rows.splice(selected.row, 1);

  // Drop merges that were entirely contained in the deleted row, shift others.
  sheet.merges = sheet.merges
    .filter((m) => !(m.startRow === selected.row && m.endRow === selected.row))
    .map((m) => {
      if (m.startRow > selected.row) {
        return { ...m, startRow: m.startRow - 1, endRow: m.endRow - 1 };
      }
      if (m.endRow >= selected.row) {
        return { ...m, endRow: Math.max(m.startRow, m.endRow - 1) };
      }
      return m;
    });

  if (sheetIndex === next.activeSheetIndex) {
    next.engine = new SheetEngine(sheet);
  } else if (next.engine === undefined) {
    delete next.engine;
  }
  return next;
}

export function deleteCol(
  model: SheetModel,
  sheetIndex: number,
  selected: CellPos | null
): SheetModel | null {
  if (!selected) return null;
  const next = cloneModel(model);
  const sheet = next.sheets[sheetIndex];
  if (!sheet || sheet.columnCount === 0) return null;

  for (const row of sheet.rows) {
    if (selected.col < row.length) {
      row.splice(selected.col, 1);
    }
  }
  sheet.columnCount = Math.max(0, sheet.columnCount - 1);
  if (sheet.columnWidths && selected.col < sheet.columnWidths.length) {
    sheet.columnWidths.splice(selected.col, 1);
  }

  sheet.merges = sheet.merges
    .filter((m) => !(m.startCol === selected.col && m.endCol === selected.col))
    .map((m) => {
      if (m.startCol > selected.col) {
        return { ...m, startCol: m.startCol - 1, endCol: m.endCol - 1 };
      }
      if (m.endCol >= selected.col) {
        return { ...m, endCol: Math.max(m.startCol, m.endCol - 1) };
      }
      return m;
    });

  if (sheetIndex === next.activeSheetIndex) {
    next.engine = new SheetEngine(sheet);
  } else if (next.engine === undefined) {
    delete next.engine;
  }
  return next;
}

/**
 * Compute per-column widths from content length. Caps at 300px per column
 * so one giant cell doesn't push the rest off-screen, with a 60px floor so
 * narrow numeric columns still have breathing room. Prefers workbook-
 * declared `columnWidths` (in Excel chars) when present.
 */
export function computeAutoWidths(sheet: SheetData, colCount: number): number[] {
  const widths: number[] = [];
  for (let c = 0; c < colCount; c++) {
    // If the workbook has an explicit width, respect that. The conversion
    // factor (~7px/char) is the standard Excel approximation for 11pt Calibri.
    const wch = sheet.columnWidths?.[c];
    if (typeof wch === 'number') {
      widths.push(Math.max(60, Math.min(300, Math.round(wch * 7))));
      continue;
    }

    // Otherwise, scan the column's cells to find the longest display string
    // and size off that. 8px/char is roughly the average width of the
    // monospace `font-mono text-xs` we use for the grid.
    let longest = 0;
    for (const row of sheet.rows) {
      const cell = row[c];
      if (!cell) continue;
      // Account for the "ƒ" formula indicator being rendered alongside.
      const extra = cell.formula ? 2 : 0;
      const len = (cell.display?.length ?? 0) + extra;
      if (len > longest) longest = len;
    }
    const px = Math.max(60, Math.min(300, longest * 8 + 16 /* padding */));
    widths.push(longest === 0 ? DEFAULT_COL_WIDTH_PX : px);
  }
  return widths;
}

export function moveSelection(
  sheet: SheetData,
  from: CellPos,
  dir: 'up' | 'down' | 'left' | 'right' | 'home' | 'end' | 'pageup' | 'pagedown' | 'top' | 'bottom'
): CellPos {
  const PAGE = 10;
  switch (dir) {
    case 'up':
      return { row: Math.max(0, from.row - 1), col: from.col };
    case 'down':
      return { row: Math.min(sheet.rows.length - 1, from.row + 1), col: from.col };
    case 'left':
      return { row: from.row, col: Math.max(0, from.col - 1) };
    case 'right':
      return { row: from.row, col: Math.min(sheet.columnCount - 1, from.col + 1) };
    case 'home':
      // Home → A of the current row
      return { row: from.row, col: 0 };
    case 'end': {
      // End → last populated column of the current row
      const row = sheet.rows[from.row];
      if (!row) return { row: from.row, col: Math.max(0, sheet.columnCount - 1) };
      let lastPopulated = 0;
      for (let c = 0; c < row.length; c++) {
        if (row[c] !== null) lastPopulated = c;
      }
      return { row: from.row, col: lastPopulated };
    }
    case 'pageup':
      return { row: Math.max(0, from.row - PAGE), col: from.col };
    case 'pagedown':
      return { row: Math.min(sheet.rows.length - 1, from.row + PAGE), col: from.col };
    case 'top':
      return { row: 0, col: 0 };
    case 'bottom': {
      // Ctrl+End → bottom-right populated cell. Scan from the bottom-right
      // inward for the last non-null cell.
      let lastRow = 0;
      let lastCol = 0;
      for (let r = 0; r < sheet.rows.length; r++) {
        const row = sheet.rows[r];
        if (!row) continue;
        for (let c = 0; c < row.length; c++) {
          if (row[c] !== null) {
            if (r > lastRow) lastRow = r;
            if (c > lastCol) lastCol = c;
          }
        }
      }
      return { row: lastRow, col: lastCol };
    }
  }
}

export function inferSpreadsheetExtension(fileName: string): SpreadsheetExtension | null {
  const ext = fileName.split('.').pop()?.toLowerCase();
  if (ext === 'xlsx' || ext === 'xls' || ext === 'csv') {
    return ext;
  }
  return null;
}
