// Spreadsheet Viewer
// Read-only viewer for `.xlsx`, `.xls`, and `.csv` files. Renders a faithful
// grid with Excel-style A/B/C column headers and 1/2/3 row numbers, supports
// merged cells, and virtualizes large sheets for smooth scrolling.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ExternalLink, FileSpreadsheet, AlertTriangle } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { openExternal } from '@/utils/openExternal';
import {
  parseSpreadsheet,
  columnIndexToLetter,
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
}

/** Anything more than this row count flips on the virtualizer. */
const VIRTUALIZE_ROW_THRESHOLD = 500;

/** Visual constants — kept local so the grid stays Excel-like and the
 *  virtualizer's row-height estimator stays accurate. */
const ROW_HEIGHT_PX = 24;
const ROW_HEADER_WIDTH_PX = 48;
const DEFAULT_COL_WIDTH_PX = 96;

export function SpreadsheetViewer({ src, fileName, className }: SpreadsheetViewerProps) {
  const [model, setModel] = useState<SheetModel | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeSheetIndex, setActiveSheetIndex] = useState(0);

  // Parse on mount / when source changes.
  useEffect(() => {
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
        onChange={setActiveSheetIndex}
      />
      <SheetGrid sheet={activeSheet} />
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
}

function SheetGrid({ sheet }: SheetGridProps) {
  const colCount = sheet.columnCount;
  const rowCount = sheet.rows.length;

  // Pre-compute merge lookup tables once per sheet.
  const mergeMaps = useMemo(() => buildMergeMaps(sheet.merges), [sheet.merges]);

  // Per-column widths: prefer workbook-declared widths (`wch`) converted to px;
  // fall back to the default. The conversion factor (~7px/char) is the
  // standard Excel approximation for the default 11pt Calibri.
  const columnWidthsPx = useMemo(() => {
    const widths: number[] = [];
    for (let c = 0; c < colCount; c++) {
      const wch = sheet.columnWidths?.[c];
      const px = typeof wch === 'number' ? Math.max(40, Math.round(wch * 7)) : DEFAULT_COL_WIDTH_PX;
      widths.push(px);
    }
    return widths;
  }, [sheet.columnWidths, colCount]);

  const totalWidthPx = useMemo(
    () => ROW_HEADER_WIDTH_PX + columnWidthsPx.reduce((sum, w) => sum + w, 0),
    [columnWidthsPx]
  );

  const scrollRef = useRef<HTMLDivElement>(null);
  const shouldVirtualize = rowCount > VIRTUALIZE_ROW_THRESHOLD;

  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT_PX,
    overscan: 12,
    enabled: shouldVirtualize,
  });

  const headerRow = (
    <div className="sticky top-0 z-20 flex bg-muted text-xs font-medium text-muted-foreground">
      <div
        className="sticky left-0 z-30 flex shrink-0 items-center justify-center border-b border-r bg-muted"
        style={{ width: ROW_HEADER_WIDTH_PX, height: ROW_HEIGHT_PX }}
      />
      {columnWidthsPx.map((width, c) => (
        <div
          key={c}
          className="flex shrink-0 items-center justify-center border-b border-r bg-muted px-1"
          style={{ width, height: ROW_HEIGHT_PX }}
        >
          {columnIndexToLetter(c)}
        </div>
      ))}
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

  return (
    <div ref={scrollRef} className="flex-1 overflow-auto bg-background">
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
}

function SheetRow({ rowIndex, cells, columnWidthsPx, mergeMaps }: SheetRowProps) {
  return (
    <div className="flex border-b" style={{ height: ROW_HEIGHT_PX }}>
      {/* Row number — sticky left so it stays visible when scrolling horizontally. */}
      <div
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
        return (
          <div
            key={colIndex}
            data-testid={`spreadsheet-cell-${rowIndex}-${colIndex}`}
            className="flex shrink-0 items-center overflow-hidden border-r px-1 py-0.5"
            style={{
              width: renderedWidth,
              height: renderedHeight,
              // Merged cells need to bleed downward past the row's own height,
              // so allow overflow and pull the visual element above siblings.
              ...(merge ? { position: 'relative', zIndex: 1 } : null),
            }}
            title={cell?.formula ? `=${cell.formula}` : cell?.display ?? undefined}
          >
            <span className="truncate">{cell?.display ?? ''}</span>
          </div>
        );
      })}
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
