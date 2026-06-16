// Spreadsheet Viewer / Editor
// Renders `.xlsx`, `.xls`, and `.csv` files with Excel-style headers, merged
// cells, and virtualization for large sheets. When `onContentChange` is
// provided and `readOnly` is not set, becomes editable: click to select,
// double-click or Enter/F2 to edit, Tab/Enter to commit, Esc to cancel.
// Formula cells show a small `ƒ` indicator and edit the formula string itself.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  ExternalLink,
  FileSpreadsheet,
  AlertTriangle,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { openExternal } from '@/utils/openExternal';
import {
  parseSpreadsheet,
  serializeSpreadsheet,
  spreadsheetBytesToDataUrl,
  columnIndexToLetter,
  type SheetModel,
  type SheetData,
  type SheetCell,
} from '@/utils/spreadsheet-io';
import {
  VIRTUALIZE_ROW_THRESHOLD,
  ROW_HEIGHT_PX,
  ROW_HEADER_WIDTH_PX,
  DEFAULT_COL_WIDTH_PX,
  buildMergeMaps,
  setCellValue,
  insertRow,
  insertCol,
  deleteRow,
  deleteCol,
  computeAutoWidths,
  moveSelection,
  inferSpreadsheetExtension,
  type CellPos,
  type MergeMaps,
} from './spreadsheetViewerHelpers';
import { FormulaBar, SelectionSummary, EditToolbar, SheetTabsBar } from './SpreadsheetChrome';

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
        // UX-18: in editable mode, keep the formula bar expanded at all
        // times so dblclick-to-edit flows never suffer a layout shift on
        // the second click. The collapse behaviour still kicks in for
        // read-only viewing.
        <FormulaBar
          sheet={activeSheet}
          selected={selected}
          expandedSticky={true}
        />
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
      {editable && (
        // UX-18: same reasoning as the formula bar above.
        <SelectionSummary
          sheet={activeSheet}
          selected={selected}
          expandedSticky={true}
        />
      )}
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
  const { t } = useTranslation();
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
        <p className="text-sm">{t('media.spreadsheet.empty-sheet')}</p>
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
  const { t } = useTranslation();
  return (
    <div
      data-testid="spreadsheet-error"
      className={cn('flex h-full flex-col items-center justify-center gap-3 px-6 text-center text-muted-foreground', className)}
    >
      <AlertTriangle className="h-10 w-10 text-destructive opacity-70" />
      <div>
        <p className="text-sm font-medium text-foreground">{t('media.spreadsheet.could-not-open', { fileName })}</p>
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
        {t('media.spreadsheet.open-native')}
      </Button>
    </div>
  );
}

export default SpreadsheetViewer;
