// Spreadsheet "chrome" view components extracted from SpreadsheetViewer.tsx
// (behavior-preserving 3.0 reorg). The formula bar, selection summary, edit
// toolbar, and sheet-tabs bar. Pure presentational; every input via props.

import { Plus, Minus, ArrowUpFromLine, ArrowDownFromLine, ArrowLeftFromLine, ArrowRightFromLine } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { columnIndexToLetter } from '@/utils/spreadsheet-io';
import type { SheetData } from '@/utils/spreadsheet-io';
import type { CellPos } from './spreadsheetViewerHelpers';

// ---------------------------------------------------------------------------
// Formula bar — shows `[A1]  =B2*1.1` above the grid when a cell is selected.
// Read-only for now; the inline cell editor is the only way to change values.
// ---------------------------------------------------------------------------

export interface FormulaBarProps {
  sheet: SheetData;
  selected: CellPos | null;
  /**
   * UX-18: when true, the bar stays expanded even if `selected` is null.
   * The SpreadsheetViewer flips this on after the FIRST cell selection
   * so subsequent dblclicks don't trigger a layout shift that would
   * otherwise make the second click of the dblclick land on a different
   * cell.
   */
  expandedSticky?: boolean;
}

export function FormulaBar({ sheet, selected, expandedSticky }: FormulaBarProps) {
  // UX-18: when no cell is selected AND we haven't yet expanded this
  // session, collapse the bar to a 5px thin divider. Once the user
  // selects any cell, `expandedSticky` flips on and stays true for the
  // lifetime of the component, keeping the grid position stable.
  if (!selected && !expandedSticky) {
    return (
      <div
        data-testid="spreadsheet-formula-bar"
        data-state="collapsed"
        className="border-b bg-muted/30"
        style={{ height: 5 }}
        aria-hidden="true"
      />
    );
  }

  const cell = selected ? sheet.rows[selected.row]?.[selected.col] ?? null : null;
  const ref = selected ? `${columnIndexToLetter(selected.col)}${selected.row + 1}` : '';
  const content = cell?.formula
    ? `=${cell.formula}`
    : cell?.display ?? '';

  return (
    <div
      data-testid="spreadsheet-formula-bar"
      data-state="expanded"
      className="flex items-center border-b bg-background px-2 py-1 gap-2 text-xs font-mono transition-[height] duration-150 ease-out"
    >
      <span
        data-testid="spreadsheet-formula-bar-ref"
        className="inline-flex items-center justify-center min-w-[48px] px-2 py-0.5 rounded-sm bg-muted text-muted-foreground font-medium"
      >
        {ref || '\u00A0'}
      </span>
      <span
        data-testid="spreadsheet-formula-bar-content"
        className="flex-1 truncate"
        title={content || undefined}
      >
        {content}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Selection summary — below the grid, shows "Value: 10000" for a single
// selected numeric cell. Keeps the app status bar clean for other file types.
// ---------------------------------------------------------------------------

export interface SelectionSummaryProps {
  sheet: SheetData;
  selected: CellPos | null;
  /**
   * UX-18: sticky-expanded flag (see FormulaBar for details).
   */
  expandedSticky?: boolean;
}

export function SelectionSummary({ sheet, selected, expandedSticky }: SelectionSummaryProps) {
  // UX-18: mirror the formula bar's collapse behaviour. Collapse only
  // on initial mount (no selection ever); stay expanded once any cell
  // was selected this session.
  if (!selected && !expandedSticky) {
    return (
      <div
        data-testid="spreadsheet-selection-summary"
        data-state="collapsed"
        className="border-t bg-muted/30"
        style={{ height: 5 }}
        aria-hidden="true"
      />
    );
  }

  const cell = selected ? sheet.rows[selected.row]?.[selected.col] ?? null : null;

  let numeric: number | null = null;
  if (cell) {
    if (typeof cell.raw === 'number' && Number.isFinite(cell.raw)) {
      numeric = cell.raw;
    } else if (typeof cell.raw === 'string') {
      const asNum = Number(cell.raw);
      if (!Number.isNaN(asNum) && cell.raw.trim() !== '') numeric = asNum;
    }
  }

  return (
    <div
      data-testid="spreadsheet-selection-summary"
      data-state="expanded"
      className="flex justify-end border-t bg-muted/30 px-3 py-1 text-xs font-mono text-muted-foreground min-h-[22px] transition-[height] duration-150 ease-out"
    >
      {numeric !== null ? `Value: ${numeric}` : '\u00A0'}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Edit toolbar
// ---------------------------------------------------------------------------

export interface EditToolbarProps {
  selected: CellPos | null;
  onInsertRowAbove: () => void;
  onInsertRowBelow: () => void;
  onInsertColLeft: () => void;
  onInsertColRight: () => void;
  onDeleteRow: () => void;
  onDeleteCol: () => void;
}

export function EditToolbar({
  selected,
  onInsertRowAbove,
  onInsertRowBelow,
  onInsertColLeft,
  onInsertColRight,
  onDeleteRow,
  onDeleteCol,
}: EditToolbarProps) {
  const disabled = !selected;
  return (
    <div
      data-testid="spreadsheet-toolbar"
      className="flex items-center gap-0.5 border-b bg-muted/30 px-2 py-1 flex-wrap"
    >
      <Button
        data-testid="spreadsheet-insert-row-above"
        variant="ghost"
        size="sm"
        className="h-7 px-2 text-xs"
        disabled={disabled}
        onClick={onInsertRowAbove}
        title="Insert row above"
      >
        <ArrowUpFromLine className="h-3.5 w-3.5 mr-1" />
        Row above
      </Button>
      <Button
        data-testid="spreadsheet-insert-row-below"
        variant="ghost"
        size="sm"
        className="h-7 px-2 text-xs"
        disabled={disabled}
        onClick={onInsertRowBelow}
        title="Insert row below"
      >
        <ArrowDownFromLine className="h-3.5 w-3.5 mr-1" />
        Row below
      </Button>
      <span className="mx-1 h-5 w-px bg-border" aria-hidden="true" />
      <Button
        data-testid="spreadsheet-insert-col-left"
        variant="ghost"
        size="sm"
        className="h-7 px-2 text-xs"
        disabled={disabled}
        onClick={onInsertColLeft}
        title="Insert column left"
      >
        <ArrowLeftFromLine className="h-3.5 w-3.5 mr-1" />
        Col left
      </Button>
      <Button
        data-testid="spreadsheet-insert-col-right"
        variant="ghost"
        size="sm"
        className="h-7 px-2 text-xs"
        disabled={disabled}
        onClick={onInsertColRight}
        title="Insert column right"
      >
        <ArrowRightFromLine className="h-3.5 w-3.5 mr-1" />
        Col right
      </Button>
      <span className="mx-1 h-5 w-px bg-border" aria-hidden="true" />
      <Button
        data-testid="spreadsheet-delete-row"
        variant="ghost"
        size="sm"
        className="h-7 px-2 text-xs text-destructive"
        disabled={disabled}
        onClick={onDeleteRow}
        title="Delete row"
      >
        <Minus className="h-3.5 w-3.5 mr-1" />
        Delete row
      </Button>
      <Button
        data-testid="spreadsheet-delete-col"
        variant="ghost"
        size="sm"
        className="h-7 px-2 text-xs text-destructive"
        disabled={disabled}
        onClick={onDeleteCol}
        title="Delete column"
      >
        <Plus className="h-3.5 w-3.5 mr-1 rotate-45" />
        Delete col
      </Button>
    </div>
  );
}

/**
 * Convert a sheet name to a stable kebab-case slug for use in `data-testid`.
 * Lower-cased, alphanumeric and dashes only — anything else collapses to `-`.
 */
export function sheetNameToTestId(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// ---------------------------------------------------------------------------
// Sheet tabs (only shown when >1 sheet)
// ---------------------------------------------------------------------------

export interface SheetTabsBarProps {
  sheets: SheetData[];
  activeIndex: number;
  onChange: (index: number) => void;
}

export function SheetTabsBar({ sheets, activeIndex, onChange }: SheetTabsBarProps) {
  if (sheets.length <= 1) return null;

  return (
    <div className="flex items-center gap-1 overflow-x-auto border-b bg-muted/30 px-2 py-1">
      {sheets.map((sheet, index) => {
        const isActive = index === activeIndex;
        return (
          <button
            key={`${sheet.name}-${index}`}
            type="button"
            data-testid={`spreadsheet-sheet-tab-${sheetNameToTestId(sheet.name)}`}
            onClick={() => onChange(index)}
            className={cn(
              'whitespace-nowrap rounded-sm px-3 py-1 text-xs font-medium transition-colors',
              isActive
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:bg-background/60 hover:text-foreground'
            )}
            aria-selected={isActive}
            role="tab"
          >
            {sheet.name}
          </button>
        );
      })}
    </div>
  );
}
