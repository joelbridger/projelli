// R-16 — CSV formula injection, proved at the chokepoint AND at every derived
// emitter that reaches it.
//
// RED-ON-FLIP: each `describe` block below names the exact edit that makes it
// fail. A guard no test reds on is decoration, so the flip is written down
// rather than assumed. The flips were RUN, not reasoned about; the report
// records the observed failures.

import { describe, it, expect } from 'vitest';

import {
  csvCell,
  csvDocument,
  csvFormulaCell,
  csvGuardedRow,
  csvVerbatimCell,
} from '@/platform/export/csvSafe';
import { entriesToCSV } from '@/features/audit/audit-export';
import { AuditService } from '@/platform/audit/AuditService';
import { createHouseholdCsv } from '@/features/crm-clients/extensions/bulk-export/csv';
import { serializeSpreadsheet, type SheetModel } from '@/platform/utils/spreadsheet-io';
import type { AuditEntry } from '@/platform/types/audit';

/** The classic payload: a DDE command a spreadsheet runs on open. */
const PAYLOAD = `=cmd|'/c calc'!A1`;

/**
 * Every character a spreadsheet application treats as "this cell is a
 * formula". The list is the guard's whole contract; if it shrinks, these fail.
 */
const FORMULA_LEADS = ['=', '+', '-', '@', '\t', '\r'];

describe('csvSafe — the chokepoint', () => {
  // FLIP: delete the `FORMULA_LEAD.test(...)` branch in csvCell.
  it.each(FORMULA_LEADS)('guards a cell beginning with %j', (lead) => {
    const encoded = csvCell(`${lead}cmd`);
    expect(encoded.startsWith("'") || encoded.startsWith('"\'')).toBe(true);
  });

  // FLIP: drop the leading-whitespace skip. Excel skips it, so we must.
  it('guards a payload hidden behind leading whitespace', () => {
    expect(csvCell(`   ${PAYLOAD}`)).toContain("'   =cmd");
  });

  it('leaves ordinary text alone', () => {
    expect(csvCell('Ada Advisor')).toBe('Ada Advisor');
    expect(csvCell('')).toBe('');
    expect(csvCell(42)).toBe('42');
  });

  it('still does RFC 4180 quoting, and quoting is NOT the guard', () => {
    expect(csvCell('Ada, Advisor')).toBe('"Ada, Advisor"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    // A quoted formula is still a formula to Excel — so the guard must fire
    // even when quoting would happen anyway.
    expect(csvCell('=1,2')).toBe('"\'=1,2"');
  });

  it('has exactly three doors, and two of them are explicit', () => {
    expect(csvFormulaCell('SUM(A1:A2)')).toBe('=SUM(A1:A2)');
    expect(csvVerbatimCell(PAYLOAD, 'a stated reason')).toBe(PAYLOAD);
    // FLIP: remove the reason check. An unguarded cell with no stated reason
    // is the exact thing the module exists to make impossible.
    expect(() => csvVerbatimCell(PAYLOAD, '   ')).toThrow(/non-empty reason/);
  });

  it('joins rows with CRLF by default', () => {
    expect(csvDocument([csvGuardedRow(['a', 'b']), csvGuardedRow(['c', 'd'])])).toBe(
      'a,b\r\nc,d',
    );
  });
});

describe('R-16 — the sixth writer: spreadsheet-io serializeCsv', () => {
  function modelWith(display: string, sourceExtension: 'xlsx' | 'csv'): SheetModel {
    return {
      sheets: [
        { name: 'Sheet1', rows: [[{ display, raw: display }]], merges: [], columnCount: 1 },
      ],
      activeSheetIndex: 0,
      sourceExtension,
    };
  }

  // THE BUG. An xlsx TEXT cell is inert in the workbook — SheetJS gives it no
  // `.f`. Saving as CSV used to write it raw, so inert text became a live
  // formula. That is a privilege elevation across a format conversion.
  //
  // FLIP: in serializeCsv, replace `csvCell(text)` with `text`.
  it('does not promote inert xlsx text into a csv formula', () => {
    const out = new TextDecoder().decode(serializeSpreadsheet(modelWith(PAYLOAD, 'xlsx'), 'csv'));
    expect(out).not.toMatch(/(^|[,\r\n"])=cmd/);
    expect(out).toContain("'=cmd");
  });

  it.each(FORMULA_LEADS)('guards an xlsx text cell beginning with %j', (lead) => {
    const out = new TextDecoder().decode(
      serializeSpreadsheet(modelWith(`${lead}danger`, 'xlsx'), 'csv'),
    );
    expect(out).toContain("'");
  });

  // The deliberate opt-out, and the reason it is not a hole: a `.csv` cell
  // whose text starts with `=` was ALREADY a live formula in the source file.
  // Guarding it would silently rewrite the user's document.
  it('round-trips a csv source verbatim', () => {
    const out = new TextDecoder().decode(serializeSpreadsheet(modelWith('=1+1', 'csv'), 'csv'));
    expect(out).toContain('=1+1');
    expect(out).not.toContain("'=1+1");
  });

  // A real formula cell stays a real formula, whatever the source format.
  it('keeps a genuine formula cell a formula', () => {
    const model: SheetModel = {
      sheets: [
        {
          name: 'Sheet1',
          rows: [[{ display: '3', raw: 3, formula: 'A1+A2' }]],
          merges: [],
          columnCount: 1,
        },
      ],
      activeSheetIndex: 0,
      sourceExtension: 'xlsx',
    };
    const out = new TextDecoder().decode(serializeSpreadsheet(model, 'csv'));
    expect(out).toContain('=A1+A2');
    expect(out).not.toContain("'=A1+A2");
  });
});

describe('the other derived CSV emitters still guard after unification', () => {
  // FLIP: revert audit-export.ts to its local escapeCsvField and delete the
  // formula branch — this reds while the chokepoint's own tests stay green,
  // which is why per-emitter proofs are kept alongside the chokepoint's.
  it('audit export', () => {
    const entry = {
      id: '1',
      timestamp: '2026-01-01T00:00:00Z',
      action: 'workflow_start',
      description: PAYLOAD,
      inputs: {},
      outputs: {},
      metadata: {},
    } as unknown as AuditEntry;
    const csv = entriesToCSV([entry]);
    expect(csv).toContain("'=cmd");
    expect(csv).not.toMatch(/(^|[,\r\n])=cmd/);
  });

  // THE NINTH WRITER. It stayed hidden one round longer than the others
  // because the first version of the derived-set checker stripped comments
  // before matching, and stripping ate the block that made this file a member.
  // FLIP: restore the old body — headers.join(',') with only the description
  // column quoted.
  it('AuditService.exportCSV (a SECOND, separate audit CSV exporter)', () => {
    const svc = new AuditService();
    svc.log('workflow_start', PAYLOAD);
    const csv = svc.exportCSV();
    expect(csv).toContain("'=cmd");
    expect(csv).not.toMatch(/(^|[,\n])=cmd/);
  });

  it('household bulk export', () => {
    const csv = createHouseholdCsv(
      [
        {
          id: 'h1',
          name: PAYLOAD,
          lifecycle: 'active',
          primaryAdvisor: 'A',
          serviceTier: 'core',
          peopleCount: 2,
        } as never,
      ],
      { includeHeader: false },
    );
    expect(csv).toContain("\"'=cmd");
  });
});
