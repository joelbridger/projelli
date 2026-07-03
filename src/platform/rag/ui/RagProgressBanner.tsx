/**
 * RagProgressBanner — slim banner across the top of the workspace shell
 * that shows live indexing progress and a Cancel button.
 *
 * Visibility rule:
 *   - status === 'indexing' AND total > 0 → render banner with progress
 *   - status === 'done' → render briefly with a "Memory ready" message
 *   - everything else → render nothing
 *
 * The banner is intentionally non-modal — users can keep editing while the
 * indexer runs.
 */

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useRagStatus } from '@/platform/hooks/useRagStatus';
import { MemoryService } from '@/platform/rag/MemoryService';
import { useOcrProgressStore } from '@/platform/rag/ocrProgressStore';
import { usePdfIndexProgressStore } from '@/platform/rag/pdfIndexProgressStore';

export interface RagProgressBannerProps {
  /** Override the live hook for tests. */
  status?: ReturnType<typeof useRagStatus>;
}

export function RagProgressBanner({ status }: RagProgressBannerProps) {
  const { t } = useTranslation();
  const live = useRagStatus();
  const snap = status ?? live;
  // doneVisible is DERIVED (not stored) so we never call setState synchronously
  // inside the auto-dismiss effect (which would cause cascading renders). A
  // "done" banner shows until its key is dismissed — either by the 4s timeout
  // or the dismiss button, both of which set state outside the effect body.
  const [dismissedKey, setDismissedKey] = useState<string | null>(null);
  const doneKey = `${snap.status}:${String(snap.total)}`;
  // VG-2 — live OCR progress. OCR is honest work (~0.5 s per scanned page),
  // so the banner says exactly which page the local engine is reading.
  const ocr = useOcrProgressStore((s) => s.current);
  const ocrLine = ocr
    ? t('memory.ocr-progress', { page: ocr.page, total: ocr.totalPages })
    : null;
  const pdf = usePdfIndexProgressStore((s) => s.current);
  const pdfLine = pdf
    ? t('memory.pdf-progress', { processed: pdf.processed, total: pdf.total })
    : null;

  // Auto-dismiss the "done" banner after a few seconds so it doesn't stick
  // around forever after an initial workspace index.
  useEffect(() => {
    if (snap.status !== 'done') return;
    const handle = window.setTimeout(() => {
      setDismissedKey(doneKey);
    }, 4000);
    return () => {
      window.clearTimeout(handle);
    };
  }, [snap.status, snap.total, doneKey]);
  const doneVisible = snap.status === 'done' && dismissedKey !== doneKey;

  if (snap.status === 'indexing' && snap.total > 0) {
    // Office/text files and PDFs are two separate passes under the hood (PDFs
    // extract in the renderer, so Rust can't report their progress through
    // the same event) — but the user is just watching "how much of my stuff
    // is left", so fold both counters into one total instead of two lines
    // that read as two unrelated jobs. A FINISHED pdf pass lingers in the
    // store for a few seconds after completion (clearSoon's display grace
    // period) purely so its own "done" line doesn't blink away instantly —
    // only fold it in while it's still genuinely mid-pass, so a brand new,
    // unrelated office-file run that starts in that grace window doesn't
    // inherit stale finished PDF numbers into its own total.
    const pdfActive = pdf !== null && pdf.processed < pdf.total;
    const combinedTotal = snap.total + (pdfActive ? pdf.total : 0);
    const combinedProcessed = snap.processed + (pdfActive ? pdf.processed : 0);
    const pct = Math.min(100, Math.round((combinedProcessed / combinedTotal) * 100));
    const fileLabel = combinedTotal === 1 ? 'file' : 'files';
    const current = snap.currentPath
      ? truncateLeft(snap.currentPath, 60)
      : null;
    return (
      <div
        data-testid="rag-progress-banner"
        role="status"
        aria-live="polite"
        className="flex items-center gap-3 px-4 py-2 border-b bg-muted/40 text-xs"
      >
        <div className="flex-1 min-w-0">
          <div className="font-medium text-foreground">
            {/* P1.1 (Task 2): honest message when this is a one-time schema
                migration rebuild, vs a routine update of new/changed files. Keep
                the numbers as JSX children (not template-literal expressions) so
                they don't trip @typescript-eslint/restrict-template-expressions. */}
            {snap.migrating ? 'Upgrading search index: ' : 'Indexing '}
            {combinedTotal} {fileLabel},{' '}
            {/* eslint-disable-next-line lantern-i18n/no-hardcoded-string */}
            {combinedProcessed} done · Nothing leaves your machine.
          </div>
          {current && (
            <div className="truncate text-muted-foreground" title={snap.currentPath ?? ''}>
              {current}
            </div>
          )}
          {ocrLine && (
            <div data-testid="rag-ocr-progress" className="truncate text-muted-foreground">
              {ocrLine}
            </div>
          )}
        </div>
        <div className="w-32 h-1.5 bg-background rounded-full overflow-hidden border" aria-hidden="true">
          <div
            className="h-full bg-primary transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>
        <button
          type="button"
          data-testid="rag-cancel-indexing"
          onClick={() => {
            void MemoryService.cancelIndexing();
          }}
          className="px-2 py-1 rounded border text-xs hover:bg-accent hover:text-accent-foreground"
        >
          Cancel
        </button>
      </div>
    );
  }

  // VG-2 — OCR running outside a workspace walk (e.g. the file watcher
  // re-indexing one scanned PDF): show the OCR line as its own slim banner.
  if (ocrLine) {
    return (
      <div
        data-testid="rag-progress-banner"
        role="status"
        aria-live="polite"
        className="flex items-center gap-3 px-4 py-2 border-b bg-muted/40 text-xs"
      >
        <span data-testid="rag-ocr-progress" className="truncate text-foreground">
          {ocrLine}
        </span>
      </div>
    );
  }

  if (pdfLine) {
    return (
      <div
        data-testid="rag-progress-banner"
        role="status"
        aria-live="polite"
        className="flex items-center gap-3 px-4 py-2 border-b bg-muted/40 text-xs"
      >
        <span
          data-testid="rag-pdf-progress"
          className="truncate text-foreground"
          title={pdf?.currentPath ?? ''}
        >
          {pdfLine}
        </span>
      </div>
    );
  }

  if (snap.status === 'done' && doneVisible && snap.total > 0) {
    // BUG-099: show "Memory ready (N files skipped)" when some files were
    // skipped, so the user knows the index is not a silent complete success.
    // No em dash in the string (house style rule).
    // Use the SUCCESSFULLY INDEXED count (total minus skipped), not total,
    // so "indexed 8 files (2 skipped)" is honest vs "indexed 10 files (2 skipped)".
    const indexedCount = Math.max(0, snap.total - snap.skipped);
    const readyLabel =
      snap.skipped > 0
        ? t('memory.rag-banner.ready-with-skips', {
            count: indexedCount,
            skipped: snap.skipped,
          })
        : t('memory.rag-banner.ready', { count: snap.total });
    return (
      <div
        data-testid="rag-progress-banner"
        role="status"
        aria-live="polite"
        className="flex items-center gap-3 px-4 py-2 border-b bg-muted/30 text-xs text-muted-foreground"
      >
        <span data-testid="rag-progress-banner-ready-label">{readyLabel}</span>
        <button
          type="button"
          data-testid="rag-progress-banner-dismiss"
          onClick={() => { setDismissedKey(doneKey); }}
          className="ml-auto text-xs underline"
        >
          Dismiss
        </button>
      </div>
    );
  }

  return null;
}

/** Trim from the left so the file name (right side) stays readable. */
function truncateLeft(value: string, max: number): string {
  if (value.length <= max) return value;
  return '…' + value.slice(value.length - max + 1);
}

export default RagProgressBanner;
