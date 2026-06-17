// Unit tests for the in-house formula engine.
// Covers tokenizing, parsing, evaluation, and the dependency graph path
// used by SpreadsheetViewer's live recomputation.

import { describe, it, expect } from 'vitest';

import {
  evaluateFormulaString,
  extractDependencies,
  formulaValueToDisplay,
} from '@/platform/utils/formula-engine';
import { SheetEngine } from '@/platform/utils/spreadsheet-io';
import type { SheetData, SheetCell } from '@/platform/utils/spreadsheet-io';

function cell(value: string | number | null, formula?: string): SheetCell {
  if (formula !== undefined) {
    return {
      display: `=${formula}`,
      raw: typeof value === 'number' ? value : value,
      formula,
    };
  }
  return {
    display: value === null ? '' : String(value),
    raw: value,
  };
}

describe('formula engine: evaluateFormulaString', () => {
  it('evaluates simple arithmetic', () => {
    expect(evaluateFormulaString('1+2*3', () => null)).toBe(7);
    expect(evaluateFormulaString('(1+2)*3', () => null)).toBe(9);
    expect(evaluateFormulaString('10/4', () => null)).toBe(2.5);
    expect(evaluateFormulaString('2^10', () => null)).toBe(1024);
  });

  it('handles unary minus and percent', () => {
    expect(evaluateFormulaString('-5+10', () => null)).toBe(5);
    expect(evaluateFormulaString('50%', () => null)).toBe(0.5);
  });

  it('resolves cell references via the lookup callback', () => {
    const lookup = (row: number, col: number) => {
      if (row === 2 && col === 1) return 10000; // B3
      if (row === 2 && col === 2) return null;  // C3 (empty)
      return null;
    };
    expect(evaluateFormulaString('B3*1.1', lookup)).toBeCloseTo(11000, 5);
  });

  it('supports SUM over a range', () => {
    const lookup = (row: number, _col: number) => {
      const values = [null, 10, 20, 30, 40];
      return values[row] ?? null;
    };
    expect(evaluateFormulaString('SUM(A2:A5)', lookup)).toBe(100);
  });

  it('supports AVERAGE, MIN, MAX', () => {
    const lookup = (row: number, _col: number) => {
      const values = [null, 10, 20, 30];
      return values[row] ?? null;
    };
    expect(evaluateFormulaString('AVERAGE(A2:A4)', lookup)).toBe(20);
    expect(evaluateFormulaString('MIN(A2:A4)', lookup)).toBe(10);
    expect(evaluateFormulaString('MAX(A2:A4)', lookup)).toBe(30);
  });

  it('supports IF with boolean conditions', () => {
    const lookup = (_r: number, _c: number) => 5;
    expect(evaluateFormulaString('IF(1>0, "yes", "no")', lookup)).toBe('yes');
    expect(evaluateFormulaString('IF(A1<0, 1, 2)', lookup)).toBe(2);
  });

  it('returns #DIV/0! on division by zero', () => {
    expect(evaluateFormulaString('1/0', () => null)).toBe('#DIV/0!');
  });

  it('returns #NAME? for unknown functions', () => {
    expect(evaluateFormulaString('FOOBAR(1)', () => null)).toBe('#NAME?');
  });

  it('returns #REF! for cross-sheet refs', () => {
    expect(evaluateFormulaString('Sheet2!A1', () => null)).toBe('#REF!');
  });
});

describe('formula engine: extractDependencies', () => {
  it('finds single cell refs', () => {
    const deps = extractDependencies('B3*1.1');
    expect(deps).toEqual([{ row: 2, col: 1 }]);
  });

  it('expands ranges into individual cells', () => {
    const deps = extractDependencies('SUM(A1:A3)');
    expect(deps).toEqual([
      { row: 0, col: 0 },
      { row: 1, col: 0 },
      { row: 2, col: 0 },
    ]);
  });

  it('returns empty for literals', () => {
    expect(extractDependencies('1+2')).toEqual([]);
  });
});

describe('formula engine: formulaValueToDisplay', () => {
  it('renders null as empty', () => {
    expect(formulaValueToDisplay(null)).toBe('');
  });
  it('renders booleans as TRUE / FALSE', () => {
    expect(formulaValueToDisplay(true)).toBe('TRUE');
    expect(formulaValueToDisplay(false)).toBe('FALSE');
  });
  it('strips 0.1+0.2 floating point drift', () => {
    expect(formulaValueToDisplay(0.1 + 0.2)).toBe('0.3');
  });
  it('passes through error strings', () => {
    expect(formulaValueToDisplay('#DIV/0!')).toBe('#DIV/0!');
  });
});

describe('SheetEngine: dependency tracking', () => {
  function fixture(): SheetData {
    // A1: header     | B1: header   | C1: header
    // A2: Jan        | B2: 10000    | C2: =B2*1.1
    // A3: Feb        | B3: 11000    | C3: =B3*1.1
    return {
      name: 'Revenue',
      rows: [
        [cell('Month'), cell('Revenue'), cell('Forecast')],
        [cell('Jan'), cell(10000), cell(11000, 'B2*1.1')],
        [cell('Feb'), cell(11000), cell(12100, 'B3*1.1')],
      ],
      merges: [],
      columnCount: 3,
    };
  }

  it('evaluates formulas on seed', () => {
    const sheet = fixture();
    const engine = new SheetEngine(sheet);
    expect(engine.getDisplay(1, 2)).toBe('11000');
    expect(engine.getDisplay(2, 2)).toBe('12100.0000000001'.replace(/\.?0+1?$/, '') || '12100');
    // The toPrecision(12) path: 11000 * 1.1 is exactly representable, so
    // should round cleanly.
    expect(engine.getDisplay(2, 2)).toMatch(/^12100/);
  });

  it('recomputes dependents when a cell changes', () => {
    const sheet = fixture();
    const engine = new SheetEngine(sheet);
    const patch = engine.updateCell(1, 1, { raw: 20000 });
    // The patch must include B2 (the edit) and C2 (dependent)
    const byKey = new Map(patch.map((p) => [`${p.row}:${p.col}`, p.display]));
    expect(byKey.get('1:1')).toBe('20000');
    expect(byKey.get('1:2')).toBe('22000');
  });

  it('returns #CIRC! on circular references', () => {
    const sheet: SheetData = {
      name: 'x',
      rows: [
        [cell(0, 'A2')],  // A1 = A2
        [cell(0, 'A1')],  // A2 = A1
      ],
      merges: [],
      columnCount: 1,
    };
    const engine = new SheetEngine(sheet);
    // At least one of the two cells must surface #CIRC!
    const d1 = engine.getDisplay(0, 0);
    const d2 = engine.getDisplay(1, 0);
    expect([d1, d2]).toContain('#CIRC!');
  });
});
