/**
 * UX-32: parseSpreadsheet must handle both data URLs AND raw text for
 * CSVs. Previously it always routed through dataUrlToArrayBuffer, which
 * calls atob() — raw CSV text isn't base64, so atob throws
 * "InvalidCharacterError: failed to execute 'atob' on 'Window': the string
 * to be decoded is not correctly encoded."
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';

import {
  parseSpreadsheet,
  serializeSpreadsheet,
  spreadsheetBytesToDataUrl,
  type SheetModel,
} from '../../src/platform/utils/spreadsheet-io';

const __dirname = dirname(fileURLToPath(import.meta.url));

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

describe('CSV export formula-injection safety', () => {
  it('neutralizes formula-leading text while preserving a negative number', async () => {
    const model: SheetModel = {
      sheets: [
        {
          name: 'Client export',
          rows: [
            [
              {
                display: '=HYPERLINK("https://attacker.test")',
                raw: '=HYPERLINK("https://attacker.test")',
              },
              { display: '+cmd', raw: '+cmd' },
              { display: '-2+3', raw: '-2+3' },
              { display: '@SUM(A1)', raw: '@SUM(A1)' },
              { display: '-42', raw: -42 },
            ],
          ],
          merges: [],
          columnCount: 5,
        },
      ],
      activeSheetIndex: 0,
      sourceExtension: 'csv',
    };

    const csv = new TextDecoder().decode(serializeSpreadsheet(model, 'csv'));
    expect(csv).toContain("'=HYPERLINK");
    expect(csv).toContain("'+cmd");
    expect(csv).toContain("'-2+3");
    expect(csv).toContain("'@SUM(A1)");

    const reparsed = await parseSpreadsheet(csv, 'csv');
    expect(reparsed.sheets[0]?.rows[0]?.map((cell) => cell?.display)).toEqual([
      "'=HYPERLINK(\"https://attacker.test\")",
      "'+cmd",
      "'-2+3",
      "'@SUM(A1)",
      '-42',
    ]);
    expect(reparsed.sheets[0]?.rows[0]?.[4]?.raw).toBe('-42');
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

// F-506 — SheetJS (production read options, no `sheetStubs`) drops openpyxl-
// style formula cells whose cached value is empty (`<f>SUM(B2:B7)</f><v></v>`).
// The totals then render EMPTY and serializeXlsx omits the cells on save —
// silent formula destruction on open → edit → autosave. The fixture is the
// REAL campaign damages-model.xlsx (openpyxl output; B10 = rows[9][1] =
// `=SUM(B2:B7)`, B11 = rows[10][1] = `=SUM(B2:B8)`).
describe('F-506 — openpyxl formula cells with empty cached values', () => {
  const fixtureBytes = readFileSync(
    join(__dirname, '..', 'fixtures', 'matter-corpus', 'damages-model.xlsx'),
  );
  // Build the same data-URL input the app feeds parseSpreadsheet.
  const fixtureDataUrl =
    'data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,' +
    fixtureBytes.toString('base64');

  it('keeps uncached formula cells, attaches the engine, and computes the totals', async () => {
    const model = await parseSpreadsheet(fixtureDataUrl, 'xlsx');
    const sheet = model.sheets[model.activeSheetIndex]!;
    const b10 = sheet.rows[9]?.[1];
    expect(b10?.formula).toBe('SUM(B2:B7)');
    expect(model.engine).toBeDefined();
    expect(b10?.display).toBe('355250');
    const b11 = sheet.rows[10]?.[1];
    expect(b11?.formula).toBe('SUM(B2:B8)');
    expect(b11?.display).toBe('855250');
  });

  it('round-trips the formulas through serialize -> reparse', async () => {
    const model = await parseSpreadsheet(fixtureDataUrl, 'xlsx');
    const bytes = serializeSpreadsheet(model, 'xlsx');
    const reparsed = await parseSpreadsheet(spreadsheetBytesToDataUrl(bytes, 'xlsx'), 'xlsx');
    const sheet = reparsed.sheets[reparsed.activeSheetIndex]!;
    expect(sheet.rows[9]?.[1]?.formula).toBe('SUM(B2:B7)');
    expect(sheet.rows[10]?.[1]?.formula).toBe('SUM(B2:B8)');
    // The reparsed model recomputes live, not from a flattened cache.
    expect(reparsed.engine).toBeDefined();
    expect(sheet.rows[9]?.[1]?.display).toBe('355250');
  });

  it('still drops genuinely blank stub cells (no formula)', async () => {
    // The committed fixture has no value-less `<c r=".."/>` stubs (openpyxl
    // writes its blank spacer cells as empty inlineStr cells, which parse as
    // `{t:'s', v:''}` with or without sheetStubs). Excel-authored files DO
    // carry such stubs (styled-but-empty cells), so build a variant in
    // memory: turn spacer cell B9 into a true stub and reparse. With
    // `sheetStubs: true` it must STILL come back as a null model cell, not
    // `{display: ''}` bloat — while the formula stub right below survives.
    const zip = await JSZip.loadAsync(fixtureBytes);
    const sheetXml = await zip.file('xl/worksheets/sheet1.xml')!.async('string');
    expect(sheetXml).toContain('<c r="B9" t="inlineStr"></c>');
    zip.file(
      'xl/worksheets/sheet1.xml',
      sheetXml.replace('<c r="B9" t="inlineStr"></c>', '<c r="B9"/>'),
    );
    const patched = await zip.generateAsync({ type: 'arraybuffer' });

    const model = await parseSpreadsheet(patched, 'xlsx');
    const sheet = model.sheets[model.activeSheetIndex]!;
    expect(sheet.rows[8]?.[1]).toBeNull();
    expect(sheet.rows[9]?.[1]?.formula).toBe('SUM(B2:B7)');
  });
});
