/**
 * UX-32: parseSpreadsheet must handle both data URLs AND raw text for
 * CSVs. Previously it always routed through dataUrlToArrayBuffer, which
 * calls atob() — raw CSV text isn't base64, so atob throws
 * "InvalidCharacterError: failed to execute 'atob' on 'Window': the string
 * to be decoded is not correctly encoded."
 */

import { describe, expect, it } from 'vitest';
import {
  parseSpreadsheet,
  serializeSpreadsheet,
  type SheetModel,
} from '../../src/utils/spreadsheet-io';

describe('parseSpreadsheet (UX-32)', () => {
  it('parses raw-text CSV without throwing an atob error', async () => {
    const raw = 'name,age,city\nAlice,30,Austin\nBob,25,Berkeley';
    const model = await parseSpreadsheet(raw, 'csv');
    const sheet = model.sheets[0];
    expect(sheet).toBeDefined();
    expect(sheet!.rows.length).toBe(3);
    expect(sheet!.rows[0]![0]?.display).toBe('name');
    expect(sheet!.rows[1]![0]?.display).toBe('Alice');
    expect(sheet!.rows[2]![2]?.display).toBe('Berkeley');
  });

  it('parses a data-URL CSV identically', async () => {
    const raw = 'a,b\n1,2';
    const b64 = typeof btoa !== 'undefined' ? btoa(raw) : Buffer.from(raw).toString('base64');
    const url = `data:text/csv;base64,${b64}`;
    const model = await parseSpreadsheet(url, 'csv');
    expect(model.sheets[0]!.rows.length).toBe(2);
    expect(model.sheets[0]!.rows[0]![1]?.display).toBe('b');
    expect(model.sheets[0]!.rows[1]![0]?.display).toBe('1');
  });

  it('parses an ArrayBuffer CSV', async () => {
    const raw = 'x,y\n10,20';
    const buffer = new TextEncoder().encode(raw).buffer as ArrayBuffer;
    const model = await parseSpreadsheet(buffer, 'csv');
    expect(model.sheets[0]!.rows[1]![1]?.display).toBe('20');
  });
});

// A6 — confirm the xlsx editor path round-trips real spreadsheet data (values +
// formulas) through serialize -> parse with high fidelity (SheetJS). This is the
// same code the SpreadsheetViewer uses to save/open .xlsx files.
describe('xlsx round-trip (A6)', () => {
  it('round-trips numeric, text, boolean values AND a formula', async () => {
    // A tiny workbook: a couple of numbers, a label, a boolean, and a SUM
    // formula over the numbers (with a cached value alongside, as Excel stores).
    const model: SheetModel = {
      sheets: [
        {
          name: 'Budget',
          rows: [
            [
              { display: 'Q1', raw: 'Q1' },
              { display: '100', raw: 100 },
            ],
            [
              { display: 'Q2', raw: 'Q2' },
              { display: '250', raw: 250 },
            ],
            [
              { display: 'Total', raw: 'Total' },
              // Formula cell: SheetJS stores `f` without the leading '='.
              { display: '350', raw: 350, formula: 'B1+B2' },
            ],
            [
              { display: 'Approved', raw: 'Approved' },
              { display: 'TRUE', raw: true },
            ],
          ],
          merges: [],
          columnCount: 2,
        },
      ],
      activeSheetIndex: 0,
      sourceExtension: 'xlsx',
    };

    // Serialize to .xlsx bytes, then parse them back.
    const bytes = serializeSpreadsheet(model, 'xlsx');
    expect(bytes.length).toBeGreaterThan(0);
    const reparsed = await parseSpreadsheet(bytes.buffer as ArrayBuffer, 'xlsx');

    const sheet = reparsed.sheets[0];
    expect(sheet).toBeDefined();
    expect(sheet!.name).toBe('Budget');

    // Values survived with their types.
    expect(sheet!.rows[0]![1]?.raw).toBe(100);
    expect(sheet!.rows[1]![1]?.raw).toBe(250);
    expect(sheet!.rows[0]![0]?.raw).toBe('Q1');
    expect(sheet!.rows[3]![1]?.raw).toBe(true);

    // The FORMULA survived as a formula (not flattened to its cached value).
    const totalCell = sheet!.rows[2]![1];
    expect(totalCell?.formula).toBe('B1+B2');

    // And the live formula engine recomputes it correctly on open.
    expect(reparsed.engine).toBeDefined();
    expect(reparsed.engine!.getDisplay(2, 1)).toBe('350');
  });
});
