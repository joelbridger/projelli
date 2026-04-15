// Spreadsheet Viewer / Editor
// Renders `.xlsx`, `.xls`, and `.csv` files with Excel-style headers, merged
// cells, and virtualization for large sheets. When `onContentChange` is
// provided and `readOnly` is not set, becomes editable: click to select,
// double-click or Enter/F2 to edit, Tab/Enter to commit, Esc to cancel.
// Formula cells show a small `ƒ` indicator and edit the formula string itself.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  ExternalLink,
  FileSpreadsheet,
  AlertTriangle,
  Plus,
  Minus,
  ArrowUpFromLine,
  ArrowDownFromLine,
  ArrowLeftFromLine,
  ArrowRightFromLine,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { openExternal } from '@/utils/openExternal';
import {
  parseSpreadsheet,
  serializeSpreadsheet,
  spreadsheetBytesToDataUrl,
  columnIndexToLetter,
  SheetEngine,
  type SheetModel,
  type SheetData,
  type SheetCell,
  type MergeRange,
  type SpreadsheetExtension,
} from '@/utils/spreadsheet-io';

interface SpreadsheetViewerProps {
  src: string;
  fileName: string;
  className?: string;
  onContentChange?: (newDataUrl: string) => void;
  /** Force read-only mode even if onContentChange is provided. */
  readOnly?: boolean;
  /** Fired just before the FIRST edit per session, so the parent can snapshot
   *  the original file to disk. Returns when the backup is written (or
   *  skipped). */
  onFirstEdit?: () => Promise<void> | void;
}

/** Anything more than this row count flips on the virtualizer. */
const VIRTUALIZE_ROW_THRESHOLD = 500;

/** Visual constants — kept local so the grid stays Excel-like and the
 *  virtualizer's row-height estimator stays accurate. */
const ROW_HEIGHT_PX = 24;
const ROW_HEADER_WIDTH_PX = 48;
const DEFAULT_COL_WIDTH_PX = 96;

interface CellPos {
  row: number;
  col: number;
}

export function SpreadsheetViewer({
  src,
  fileName,
  className,
  onContentChange,
  readOnly,
  onFirstEdit,
}: SpreadsheetViewerProps) {
  const [model, setModel] = useState<SheetModel | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeSheetIndex, setActiveSheetIndex] = useState(0);
  const [selected, setSelected] = useState<CellPos | null>(null);
  const [editingValue, setEditingValue] = useState<string | null>(null);

  const editable = Boolean(onContentChange) && !readOnly;
  const firstEditFiredRef = useRef(false);

  // Track the last data URL we pushed upstream so incoming `src` round-trips
  // don't cause an infinite re-parse loop.
  const lastPushedDataUrlRef = useRef<string | null>(null);

  // Parse on mount / when source changes.
  useEffect(() => {
    // Skip re-parse if src matches what we just serialized + pushed upstream.
    if (src === lastPushedDataUrlRef.current) {
      return;
    }

    let cancelled = false;
    setError(null);
    setModel(null);

    const extension = inferSpreadsheetExtension(fileName);
    if (!extension) {
      setError(`Unsupported spreadsheet extension for "${fileName}".`);
      return () => {
        cancelled = true;
      };
    }

    parseSpreadsheet(src, extension)
      .then((parsed) => {
        if (cancelled) return;
        setModel(parsed);
        setActiveSheetIndex(parsed.activeSheetIndex);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : 'Unknown error.';
        setError(`Failed to parse spreadsheet: ${message}`);
      });

    return () => {
      cancelled = true;
    };
  }, [src, fileName]);

  const commitModel = useCallback(
    async (nextModel: SheetModel) => {
      setModel(nextModel);
      if (!editable || !onContentChange) return;

      // Fire first-edit hook (for backup write) before pushing updated content.
      if (!firstEditFiredRef.current) {
        firstEditFiredRef.current = true;
        try {
          await onFirstEdit?.();
        } catch (err) {
          console.warn('[SpreadsheetViewer] onFirstEdit failed:', err);
        }
      }

      const bytes = serializeSpreadsheet(nextModel, nextModel.sourceExtension);
      const dataUrl = spreadsheetBytesToDataUrl(bytes, nextModel.sourceExtension);
      lastPushedDataUrlRef.current = dataUrl;
      onContentChange(dataUrl);
    },
    [editable, onContentChange, onFirstEdit]
  );

  if (error) {
    return <SpreadsheetError fileName={fileName} message={error} className={className} />;
  }

  if (!model) {
    return <SpreadsheetSkeleton fileName={fileName} className={className} />;
  }

  const activeSheet = model.sheets[activeSheetIndex] ?? model.sheets[0];
  if (!activeSheet) {
    return (
      <SpreadsheetError
        fileName={fileName}
        message="This file contains no sheets."
        className={className}
      />
    );
  }

  return (
    <div
      data-testid="spreadsheet-viewer"
      className={cn('flex h-full flex-col bg-background', className)}
    >
      <SheetTabsBar
        sheets={model.sheets}
        activeIndex={activeSheetIndex}
        onChange={(i) => {
          setActiveSheetIndex(i);
          setSelected(null);
          setEditingValue(null);
        }}
      />
      {editable && (
        <EditToolbar
          selected={selected}
          onInsertRowAbove={() => commitModel(insertRow(model, activeSheetIndex, selected, 'above'))}
          onInsertRowBelow={() => commitModel(insertRow(model, activeSheetIndex, selected, 'below'))}
          onInsertColLeft={() => commitModel(insertCol(model, activeSheetIndex, selected, 'left'))}
          onInsertColRight={() => commitModel(insertCol(model, activeSheetIndex, selected, 'right'))}
          onDeleteRow={() => {
            const next = deleteRow(model, activeSheetIndex, selected);
            if (!next) return;
            commitModel(next);
          }}
          onDeleteCol={() => {
            const next = deleteCol(model, activeSheetIndex, selected);
            if (!next) return;
            commitModel(next);
          }}
        />
      )}
      {editable && (
        <FormulaBar sheet={activeSheet} selected={selected} />
      )}
      <SheetGrid
        sheet={activeSheet}
        editable={editable}
        selected={selected}
        editingValue={editingValue}
        onSelect={(pos) => {
          setSelected(pos);
          setEditingValue(null);
        }}
        onStartEdit={(pos, initial) => {
          setSelected(pos);
          setEditingValue(initial ?? '');
        }}
        onCommitEdit={(pos, value, nextMove) => {
          const nextModel = setCellValue(model, activeSheetIndex, pos, value);
          commitModel(nextModel);
          setEditingValue(null);
          if (nextMove === 'down') {
            setSelected({ row: Math.min(pos.row + 1, activeSheet.rows.length - 1), col: pos.col });
          } else if (nextMove === 'right') {
            setSelected({ row: pos.row, col: Math.min(pos.col + 1, activeSheet.columnCount - 1) });
          } else {
            setSelected(pos);
          }
        }}
        onCancelEdit={() => setEditingValue(null)}
        onDeleteCell={(pos) => {
          const nextModel = setCellValue(model, activeSheetIndex, pos, '');
          commitModel(nextModel);
        }}
        onMoveSelection={(dir) => {
          if (!selected) return;
          setSelected(moveSelection(activeSheet, selected, dir));
        }}
      />
      {editable && <SelectionSummary sheet={activeSheet} selected={selected} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Formula bar — shows `[A1]  =B2*1.1` above the grid when a cell is selected.
// Read-only for now; the inline cell editor is the only way to change values.
// ---------------------------------------------------------------------------

interface FormulaBarProps {
  sheet: SheetData;
  selected: CellPos | null;
}

function FormulaBar({ sheet, selected }: FormulaBarProps) {
  // Always render so the grid's vertical position is stable; when no cell
  // is selected, show an empty cell-reference box and blank content. If the
  // bar only rendered when `selected` was non-null, the first click would
  // shift the grid down by the bar's height, causing the second click of a
  // dblclick to land on the wrong cell.
  const cell = selected ? sheet.rows[selected.row]?.[selected.col] ?? null : null;
  const ref = selected ? `${columnIndexToLetter(selected.col)}${selected.row + 1}` : '';
  const content = cell?.formula
    ? `=${cell.formula}`
    : cell?.display ?? '';

  return (
    <div
      data-testid="spreadsheet-formula-bar"
      className="flex items-center border-b bg-background px-2 py-1 gap-2 text-xs font-mono"
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

interface SelectionSummaryProps {
  sheet: SheetData;
  selected: CellPos | null;
}

function SelectionSummary({ sheet, selected }: SelectionSummaryProps) {
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

  // Always render the footer so the grid height is stable (see FormulaBar).
  return (
    <div
      data-testid="spreadsheet-selection-summary"
      className="flex justify-end border-t bg-muted/30 px-3 py-1 text-xs font-mono text-muted-foreground min-h-[22px]"
    >
      {numeric !== null ? `Value: ${numeric}` : '\u00A0'}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Edit toolbar
// ---------------------------------------------------------------------------

interface EditToolbarProps {
  selected: CellPos | null;
  onInsertRowAbove: () => void;
  onInsertRowBelow: () => void;
  onInsertColLeft: () => void;
  onInsertColRight: () => void;
  onDeleteRow: () => void;
  onDeleteCol: () => void;
}

function EditToolbar({
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
function sheetNameToTestId(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// ---------------------------------------------------------------------------
// Sheet tabs (only shown when >1 sheet)
// ---------------------------------------------------------------------------

interface SheetTabsBarProps {
  sheets: SheetData[];
  activeIndex: number;
  onChange: (index: number) => void;
}

function SheetTabsBar({ sheets, activeIndex, onChange }: SheetTabsBarProps) {
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

// ---------------------------------------------------------------------------
// Grid
// ---------------------------------------------------------------------------

interface SheetGridProps {
  sheet: SheetData;
  editable: boolean;
  selected: CellPos | null;
  editingValue: string | null;
  onSelect: (pos: CellPos) => void;
  onStartEdit: (pos: CellPos, initial?: string) => void;
  onCommitEdit: (pos: CellPos, value: string, nextMove: 'down' | 'right' | 'stay') => void;
  onCancelEdit: () => void;
  onDeleteCell: (pos: CellPos) => void;
  onMoveSelection: (dir: 'up' | 'down' | 'left' | 'right' | 'home' | 'end' | 'pageup' | 'pagedown' | 'top' | 'bottom') => void;
}

function SheetGrid({
  sheet,
  editable,
  selected,
  editingValue,
  onSelect,
  onStartEdit,
  onCommitEdit,
  onCancelEdit,
  onDeleteCell,
  onMoveSelection,
}: SheetGridProps) {
  const colCount = sheet.columnCount;
  const rowCount = sheet.rows.length;

  // Pre-compute merge lookup tables once per sheet.
  const mergeMaps = useMemo(() => buildMergeMaps(sheet.merges), [sheet.merges]);

  // Per-column widths. Initialized from content auto-sizing on first load and
  // whenever the sheet changes, but stored in state so drag-to-resize can
  // override per-column values. `userOverrides` tracks columns the user
  // explicitly resized so later auto-size passes don't clobber them.
  const [columnWidthsPx, setColumnWidthsPx] = useState<number[]>(() =>
    computeAutoWidths(sheet, colCount)
  );
  const userOverridesRef = useRef<Set<number>>(new Set());
  const lastSheetRef = useRef<SheetData | null>(null);

  useEffect(() => {
    // Re-compute auto widths when the sheet changes, preserving any columns
    // the user has explicitly dragged. Cheap — runs O(rows × cols) once per
    // sheet switch, capped at the sheet's actual size.
    if (lastSheetRef.current === sheet) return;
    lastSheetRef.current = sheet;
    const fresh = computeAutoWidths(sheet, colCount);
    setColumnWidthsPx((prev) => {
      // Keep overrides, pull in new auto values for the rest.
      return fresh.map((w, i) => (userOverridesRef.current.has(i) ? prev[i] ?? w : w));
    });
  }, [sheet, colCount]);

  const totalWidthPx = useMemo(
    () => ROW_HEADER_WIDTH_PX + columnWidthsPx.reduce((sum, w) => sum + w, 0),
    [columnWidthsPx]
  );

  const scrollRef = useRef<HTMLDivElement>(null);
  const shouldVirtualize = rowCount > VIRTUALIZE_ROW_THRESHOLD;

  // Drag-to-resize state. Tracked via a ref so the mousemove handler reads
  // the latest values without triggering re-renders per pixel.
  const resizeRef = useRef<{ colIndex: number; startX: number; startWidth: number } | null>(null);

  const onResizeStart = useCallback(
    (colIndex: number, e: React.MouseEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      const startWidth = columnWidthsPx[colIndex] ?? DEFAULT_COL_WIDTH_PX;
      resizeRef.current = { colIndex, startX: e.clientX, startWidth };

      const onMove = (ev: MouseEvent) => {
        const r = resizeRef.current;
        if (!r) return;
        const delta = ev.clientX - r.startX;
        const next = Math.max(40, r.startWidth + delta);
        setColumnWidthsPx((prev) => {
          const out = prev.slice();
          out[r.colIndex] = next;
          return out;
        });
      };
      const onUp = () => {
        const r = resizeRef.current;
        if (r) userOverridesRef.current.add(r.colIndex);
        resizeRef.current = null;
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    },
    [columnWidthsPx]
  );

  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT_PX,
    overscan: 12,
    enabled: shouldVirtualize,
  });

  // Keyboard handler at grid level — handles nav + enter-to-edit when the
  // user isn't currently in edit mode.
  const handleGridKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (!editable || editingValue !== null) return;
      if (!selected) return;

      const ctrlOrMeta = e.ctrlKey || e.metaKey;

      switch (e.key) {
        case 'ArrowUp':
          e.preventDefault();
          onMoveSelection('up');
          break;
        case 'ArrowDown':
          e.preventDefault();
          onMoveSelection('down');
          break;
        case 'ArrowLeft':
          e.preventDefault();
          onMoveSelection('left');
          break;
        case 'ArrowRight':
          e.preventDefault();
          onMoveSelection('right');
          break;
        case 'Home':
          e.preventDefault();
          onMoveSelection(ctrlOrMeta ? 'top' : 'home');
          break;
        case 'End':
          e.preventDefault();
          onMoveSelection(ctrlOrMeta ? 'bottom' : 'end');
          break;
        case 'PageUp':
          e.preventDefault();
          onMoveSelection('pageup');
          break;
        case 'PageDown':
          e.preventDefault();
          onMoveSelection('pagedown');
          break;
        case 'Enter':
        case 'F2': {
          e.preventDefault();
          const cell = sheet.rows[selected.row]?.[selected.col];
          const initial = cell?.formula ? `=${cell.formula}` : cell?.display ?? '';
          onStartEdit(selected, initial);
          break;
        }
        case 'Delete':
        case 'Backspace':
          e.preventDefault();
          onDeleteCell(selected);
          break;
        default:
          // Any printable character (no modifier) starts editing with that
          // character. Ctrl/Meta-prefixed keys (Ctrl+C etc) pass through to
          // the browser.
          if (e.key.length === 1 && !ctrlOrMeta && !e.altKey) {
            e.preventDefault();
            onStartEdit(selected, e.key);
          }
      }
    },
    [editable, editingValue, selected, sheet.rows, onMoveSelection, onStartEdit, onDeleteCell]
  );

  const headerRow = (
    <div
      role="row"
      className="sticky top-0 z-20 flex bg-muted text-xs font-medium text-muted-foreground"
    >
      <div
        className="sticky left-0 z-30 flex shrink-0 items-center justify-center border-b border-r bg-muted"
        style={{ width: ROW_HEADER_WIDTH_PX, height: ROW_HEIGHT_PX }}
      />
      {columnWidthsPx.map((width, c) => {
        const letter = columnIndexToLetter(c);
        return (
          <div
            key={c}
            role="columnheader"
            data-testid={`spreadsheet-column-header-${letter}`}
            className="relative flex shrink-0 items-center justify-center border-b border-r bg-muted px-1"
            style={{ width, height: ROW_HEIGHT_PX }}
          >
            {letter}
            {/* Drag-to-resize handle: 4px-wide invisible strip on the right
                edge. Pointer cursor + mousedown kicks off the resize loop. */}
            <div
              data-testid={`spreadsheet-column-resize-${letter}`}
              role="separator"
              aria-orientation="vertical"
              aria-label={`Resize column ${letter}`}
              className="absolute right-0 top-0 h-full w-1 cursor-col-resize hover:bg-blue-500/40"
              style={{ zIndex: 10 }}
              onMouseDown={(e) => onResizeStart(c, e)}
            />
          </div>
        );
      })}
    </div>
  );

  // Empty-sheet message.
  if (rowCount === 0 || colCount === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center text-muted-foreground">
        <FileSpreadsheet className="mb-2 h-10 w-10 opacity-40" />
        <p className="text-sm">This sheet is empty.</p>
      </div>
    );
  }

  const sharedRowProps = {
    editable,
    selected,
    editingValue,
    onSelect,
    onStartEdit,
    onCommitEdit,
    onCancelEdit,
  };

  return (
    <div
      ref={scrollRef}
      className="flex-1 overflow-auto bg-background outline-none"
      tabIndex={0}
      onKeyDown={handleGridKeyDown}
      role="grid"
      aria-rowcount={rowCount + 1 /* +1 for the header row */}
      aria-colcount={colCount + 1 /* +1 for the row-number column */}
      aria-readonly={!editable}
    >
      <div style={{ width: totalWidthPx, position: 'relative' }} className="font-mono text-xs">
        {headerRow}
        {shouldVirtualize ? (
          <div
            style={{
              height: virtualizer.getTotalSize(),
              position: 'relative',
            }}
          >
            {virtualizer.getVirtualItems().map((virtualRow) => (
              <div
                key={virtualRow.key}
                style={{
                  position: 'absolute',
                  top: virtualRow.start,
                  left: 0,
                  width: '100%',
                  height: virtualRow.size,
                }}
              >
                <SheetRow
                  rowIndex={virtualRow.index}
                  cells={sheet.rows[virtualRow.index] ?? []}
                  columnWidthsPx={columnWidthsPx}
                  mergeMaps={mergeMaps}
                  {...sharedRowProps}
                />
              </div>
            ))}
          </div>
        ) : (
          <div>
            {sheet.rows.map((cells, rowIndex) => (
              <SheetRow
                key={rowIndex}
                rowIndex={rowIndex}
                cells={cells}
                columnWidthsPx={columnWidthsPx}
                mergeMaps={mergeMaps}
                {...sharedRowProps}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Row / cell
// ---------------------------------------------------------------------------

interface SheetRowProps {
  rowIndex: number;
  cells: (SheetCell | null)[];
  columnWidthsPx: number[];
  mergeMaps: MergeMaps;
  editable: boolean;
  selected: CellPos | null;
  editingValue: string | null;
  onSelect: (pos: CellPos) => void;
  onStartEdit: (pos: CellPos, initial?: string) => void;
  onCommitEdit: (pos: CellPos, value: string, nextMove: 'down' | 'right' | 'stay') => void;
  onCancelEdit: () => void;
}

function SheetRow({
  rowIndex,
  cells,
  columnWidthsPx,
  mergeMaps,
  editable,
  selected,
  editingValue,
  onSelect,
  onStartEdit,
  onCommitEdit,
  onCancelEdit,
}: SheetRowProps) {
  return (
    <div
      role="row"
      aria-rowindex={rowIndex + 2 /* +2: header is row 1, data starts at 2 */}
      className="flex border-b"
      style={{ height: ROW_HEIGHT_PX }}
    >
      {/* Row number — sticky left so it stays visible when scrolling horizontally. */}
      <div
        role="rowheader"
        className="sticky left-0 z-10 flex shrink-0 items-center justify-center border-r bg-muted text-xs font-medium text-muted-foreground"
        style={{ width: ROW_HEADER_WIDTH_PX, height: ROW_HEIGHT_PX }}
      >
        {rowIndex + 1}
      </div>
      {columnWidthsPx.map((width, colIndex) => {
        const skipKey = `${rowIndex}:${colIndex}`;
        if (mergeMaps.skip.has(skipKey)) {
          // This cell is consumed by a merge that started above/left.
          return null;
        }

        const mergeKey = `${rowIndex}:${colIndex}`;
        const merge = mergeMaps.origin.get(mergeKey);

        let renderedWidth = width;
        if (merge) {
          // Span the widths of all merged columns.
          renderedWidth = 0;
          for (let c = merge.startCol; c <= merge.endCol; c++) {
            renderedWidth += columnWidthsPx[c] ?? DEFAULT_COL_WIDTH_PX;
          }
        }

        const renderedHeight = merge
          ? (merge.endRow - merge.startRow + 1) * ROW_HEIGHT_PX
          : ROW_HEIGHT_PX;

        const cell = cells[colIndex] ?? null;
        const isSelected = editable && selected?.row === rowIndex && selected?.col === colIndex;
        const isEditing = isSelected && editingValue !== null;

        return (
          <Cell
            key={colIndex}
            rowIndex={rowIndex}
            colIndex={colIndex}
            width={renderedWidth}
            height={renderedHeight}
            cell={cell}
            isMerged={Boolean(merge)}
            editable={editable}
            isSelected={Boolean(isSelected)}
            isEditing={Boolean(isEditing)}
            editingValue={editingValue}
            onSelect={onSelect}
            onStartEdit={onStartEdit}
            onCommitEdit={onCommitEdit}
            onCancelEdit={onCancelEdit}
          />
        );
      })}
    </div>
  );
}

interface CellProps {
  rowIndex: number;
  colIndex: number;
  width: number;
  height: number;
  cell: SheetCell | null;
  isMerged: boolean;
  editable: boolean;
  isSelected: boolean;
  isEditing: boolean;
  editingValue: string | null;
  onSelect: (pos: CellPos) => void;
  onStartEdit: (pos: CellPos, initial?: string) => void;
  onCommitEdit: (pos: CellPos, value: string, nextMove: 'down' | 'right' | 'stay') => void;
  onCancelEdit: () => void;
}

function Cell({
  rowIndex,
  colIndex,
  width,
  height,
  cell,
  isMerged,
  editable,
  isSelected,
  isEditing,
  editingValue,
  onSelect,
  onStartEdit,
  onCommitEdit,
  onCancelEdit,
}: CellProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const textSpanRef = useRef<HTMLSpanElement>(null);
  const [isTruncated, setIsTruncated] = useState(false);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  // Detect whether the display text is being ellipsized. If so, supply a
  // `title` attribute so the browser shows a native tooltip on hover with
  // the full text. Checking `scrollWidth > clientWidth` after layout is the
  // idiomatic way to detect CSS ellipsis overflow.
  useLayoutEffect(() => {
    const el = textSpanRef.current;
    if (!el) return;
    const next = el.scrollWidth > el.clientWidth + 1; // 1px tolerance
    setIsTruncated((prev) => (prev === next ? prev : next));
  }, [cell?.display, width]);

  const testId = `spreadsheet-cell-${rowIndex}-${colIndex}`;
  const displayText = cell?.display ?? '';
  const hasFormula = Boolean(cell?.formula);

  if (isEditing) {
    return (
      <div
        data-testid={testId}
        data-selected="true"
        role="gridcell"
        aria-rowindex={rowIndex + 2}
        aria-colindex={colIndex + 2}
        aria-readonly={false}
        className="flex shrink-0 items-center overflow-visible border-r p-0"
        style={{
          width,
          height,
          ...(isMerged ? { position: 'relative', zIndex: 1 } : null),
        }}
      >
        <input
          ref={inputRef}
          data-testid={`spreadsheet-cell-input-${rowIndex}-${colIndex}`}
          type="text"
          defaultValue={editingValue ?? ''}
          className="w-full h-full px-1 py-0.5 bg-background border-2 border-blue-500 outline-none font-mono text-xs"
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault();
              onCancelEdit();
            } else if (e.key === 'Enter') {
              e.preventDefault();
              onCommitEdit({ row: rowIndex, col: colIndex }, e.currentTarget.value, 'down');
            } else if (e.key === 'Tab') {
              e.preventDefault();
              onCommitEdit({ row: rowIndex, col: colIndex }, e.currentTarget.value, 'right');
            }
          }}
          onBlur={(e) => {
            onCommitEdit({ row: rowIndex, col: colIndex }, e.currentTarget.value, 'stay');
          }}
        />
      </div>
    );
  }

  // Prefer the richer formula tooltip when the cell has one; otherwise fall
  // back to the full display text when it's truncated, and skip the tooltip
  // entirely when the text fits (avoids noisy hover for short cells).
  const titleText = cell?.formula
    ? `=${cell.formula}`
    : isTruncated
    ? displayText
    : undefined;

  const cellStyle: CSSProperties = {
    width,
    height,
    ...(isMerged ? { position: 'relative', zIndex: 1 } : null),
  };

  return (
    <div
      data-testid={testId}
      role="gridcell"
      aria-rowindex={rowIndex + 2}
      aria-colindex={colIndex + 2}
      aria-selected={isSelected || undefined}
      aria-readonly={true}
      {...(isSelected ? { 'data-testid-suffix': 'selected' } : {})}
      className={cn(
        'flex shrink-0 items-center overflow-hidden border-r px-1 py-0.5 cursor-cell',
        isSelected && 'ring-2 ring-blue-500 ring-inset z-10 relative'
      )}
      style={cellStyle}
      {...(titleText !== undefined ? { title: titleText } : {})}
      onClick={() => {
        if (editable) onSelect({ row: rowIndex, col: colIndex });
      }}
      onDoubleClick={() => {
        if (!editable) return;
        const initial = cell?.formula ? `=${cell.formula}` : displayText;
        onStartEdit({ row: rowIndex, col: colIndex }, initial);
      }}
    >
      {isSelected && (
        <span
          data-testid="spreadsheet-cell-selected"
          className="sr-only"
          aria-live="polite"
        >
          Cell {columnIndexToLetter(colIndex)}{rowIndex + 1} selected
        </span>
      )}
      <span ref={textSpanRef} className="truncate">{displayText}</span>
      {hasFormula && (
        <span
          className="ml-1 text-[9px] text-blue-500 italic font-serif"
          title="This cell contains a formula"
          aria-label="formula cell"
        >
          ƒ
        </span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Merge bookkeeping
// ---------------------------------------------------------------------------

interface MergeMaps {
  /** Cells that should NOT render — they're covered by a merge from above/left. */
  skip: Set<string>;
  /** Cells that ARE the top-left origin of a merge — render with span. */
  origin: Map<string, MergeRange>;
}

function buildMergeMaps(merges: MergeRange[]): MergeMaps {
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

function cloneSheet(sheet: SheetData): SheetData {
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

function cloneModel(model: SheetModel): SheetModel {
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

function valueToCell(value: string): SheetCell | null {
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

function setCellValue(
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

function insertRow(
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

function insertCol(
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

function deleteRow(
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

function deleteCol(
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
function computeAutoWidths(sheet: SheetData, colCount: number): number[] {
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

function moveSelection(
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

// ---------------------------------------------------------------------------
// Loading + error states
// ---------------------------------------------------------------------------

function SpreadsheetSkeleton({ fileName, className }: { fileName: string; className?: string | undefined }) {
  return (
    <div
      data-testid="spreadsheet-loading"
      className={cn('flex h-full flex-col items-center justify-center gap-2 text-muted-foreground', className)}
    >
      <FileSpreadsheet className="h-10 w-10 animate-pulse opacity-50" />
      <p className="text-sm">Opening {fileName}...</p>
    </div>
  );
}

interface SpreadsheetErrorProps {
  fileName: string;
  message: string;
  className?: string | undefined;
}

function SpreadsheetError({ fileName, message, className }: SpreadsheetErrorProps) {
  return (
    <div
      data-testid="spreadsheet-error"
      className={cn('flex h-full flex-col items-center justify-center gap-3 px-6 text-center text-muted-foreground', className)}
    >
      <AlertTriangle className="h-10 w-10 text-destructive opacity-70" />
      <div>
        <p className="text-sm font-medium text-foreground">Couldn't open {fileName}</p>
        <p className="mt-1 text-xs text-muted-foreground">{message}</p>
      </div>
      {/* TODO: When we wire up the Tauri command for opening the original file
          from disk, swap this for `openExternal(filePath)` against the absolute
          path. For now, this is a no-op placeholder so the UI is consistent. */}
      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          void openExternal('https://support.microsoft.com/excel');
        }}
      >
        <ExternalLink className="mr-2 h-4 w-4" />
        Open in native app
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function inferSpreadsheetExtension(fileName: string): SpreadsheetExtension | null {
  const ext = fileName.split('.').pop()?.toLowerCase();
  if (ext === 'xlsx' || ext === 'xls' || ext === 'csv') {
    return ext;
  }
  return null;
}

export default SpreadsheetViewer;
