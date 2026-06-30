// Spreadsheet Viewer / Editor
// Renders `.xlsx`, `.xls`, and `.csv` files with Excel-style headers, merged
// cells, and virtualization for large sheets. When `onContentChange` is
// provided and `readOnly` is not set, becomes editable: click to select,
// double-click or Enter/F2 to edit, Tab/Enter to commit, Esc to cancel.
// Formula cells show a small `ƒ` indicator and edit the formula string itself.

import { useCallback, useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import {
  parseSpreadsheet,
  serializeSpreadsheet,
  spreadsheetBytesToDataUrl,
  type SheetModel,
} from '@/platform/utils/spreadsheet-io';
import {
  setCellValue,
  insertRow,
  insertCol,
  deleteRow,
  deleteCol,
  moveSelection,
  inferSpreadsheetExtension,
  type CellPos,
} from './spreadsheetViewerHelpers';
import { FormulaBar, SelectionSummary, EditToolbar, SheetTabsBar } from './SpreadsheetChrome';
import { SheetGrid } from './SheetGrid';
import { SpreadsheetSkeleton, SpreadsheetError } from './SpreadsheetStates';

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
            void commitModel(next);
          }}
          onDeleteCol={() => {
            const next = deleteCol(model, activeSheetIndex, selected);
            if (!next) return;
            void commitModel(next);
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
          void commitModel(nextModel);
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
          void commitModel(nextModel);
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

export default SpreadsheetViewer;
