/**
 * Codex QA: formula recalculation on a NON-first worksheet.
 *
 * The spreadsheet model carries a single formula engine that targets
 * `model.activeSheetIndex`. Editing a cell on a different sheet (e.g. the user
 * switched to sheet 2 in the tab bar) previously skipped recalculation, so
 * dependent formulas on sheets 2+ showed — and saved — stale values. The fix
 * retargets the engine to whatever sheet is being edited.
 */

import { describe, expect, it } from 'vitest';
import { setCellValue } from '@/features/documents/media/spreadsheetViewerHelpers';
import { SheetEngine, type SheetData, type SheetModel } from '@/platform/utils/spreadsheet-io';

function num(n: number): { display: string; raw: number } {
  return { display: String(n), raw: n };
}

function twoSheetModel(): SheetModel {
  const sheet0: SheetData = {
    name: 'Sheet1',
    rows: [[num(1)]],
    merges: [],
    columnCount: 1,
  };
  const sheet1: SheetData = {
    name: 'Sheet2',
    rows: [
      [null, num(10)], // B1 = 10
      [null, num(20)], // B2 = 20
      [null, { display: '30', raw: 30, formula: 'B1+B2' }], // B3 = B1+B2 (cached 30)
    ],
    merges: [],
    columnCount: 2,
  };
  return {
    sheets: [sheet0, sheet1],
    activeSheetIndex: 0, // active sheet 0 has NO formulas, so the parser seeds no engine
    sourceExtension: 'xlsx',
    // No engine to start — exactly the workbook shape that broke recalc:
    // formulas live only on a non-active sheet, so nothing seeded an engine.
  };
}

describe('spreadsheet — formula recalc on a non-active sheet', () => {
  it('recomputes a dependent formula when editing a precedent on sheet 2', () => {
    const model = twoSheetModel();
    // Edit B1 on sheet index 1 (NOT the active sheet) from 10 to 100.
    const next = setCellValue(model, 1, { row: 0, col: 1 }, '100');

    // B3 (=B1+B2) on sheet 2 must recompute to 120 — not stay at the cached 30.
    const b3 = next.sheets[1]?.rows[2]?.[1];
    expect(b3?.formula).toBe('B1+B2');
    expect(b3?.display).toBe('120');

    // The engine retargeted to the edited sheet.
    expect(next.activeSheetIndex).toBe(1);
  });

  it('still recomputes formulas when editing the already-active sheet (no regression)', () => {
    const model: SheetModel = {
      sheets: [
        {
          name: 'Only',
          rows: [
            [null, num(5)], // B1 = 5
            [null, { display: '5', raw: 5, formula: 'B1*2' }], // B2 = B1*2 (cached 5, wrong on purpose)
          ],
          merges: [],
          columnCount: 2,
        },
      ],
      activeSheetIndex: 0,
      sourceExtension: 'xlsx',
    };
    model.engine = new SheetEngine(model.sheets[0]!);
    const next = setCellValue(model, 0, { row: 0, col: 1 }, '7'); // B1 = 7
    const b2 = next.sheets[0]?.rows[1]?.[1];
    expect(b2?.display).toBe('14'); // 7 * 2
  });
});
