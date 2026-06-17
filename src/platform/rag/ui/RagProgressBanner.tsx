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
import { useRagStatus } from '@/hooks/useRagStatus';
import { MemoryService } from '@/platform/rag/MemoryService';
import { useOcrProgressStore } from '@/platform/rag/ocrProgressStore';

export interface RagProgressBannerProps {
  /** Override the live hook for tests. */
  status?: ReturnType<typeof useRagStatus>;
}

export function RagProgressBanner({ status }: RagProgressBannerProps) {
  const { t } = useTranslation();
  const live = useRagStatus();
  const snap = status ?? live;
  const [doneVisible, setDoneVisible] = useState(false);
  // VG-2 — live OCR progress. OCR is honest work (~0.5 s per scanned page),
  // so the banner says exactly which page the local engine is reading.
  const ocr = useOcrProgressStore((s) => s.current);
  const ocrLine = ocr
    ? t('memory.ocr-progress', { page: ocr.page, total: ocr.totalPages })
    : null;

  // Auto-dismiss the "done" banner after a few seconds so it doesn't stick
  // around forever after an initial workspace index.
  useEffect(() => {
    if (snap.status !== 'done') {
      setDoneVisible(false);
      return;
    }
    setDoneVisible(true);
    const handle = window.setTimeout(() => setDoneVisible(false), 4000);
    return () => window.clearTimeout(handle);
  }, [snap.status, snap.total]);

  if (snap.status === 'indexing' && snap.total > 0) {
    const pct = Math.min(100, Math.round((snap.processed / snap.total) * 100));
    const fileLabel =
      snap.processed === 1 ? 'file' : 'files';
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
            Indexing workspace: {snap.processed} / {snap.total} {fileLabel} ({pct}%)
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

  if (snap.status === 'done' && doneVisible && snap.total > 0) {
    return (
      <div
        data-testid="rag-progress-banner"
        role="status"
        aria-live="polite"
        className="flex items-center gap-3 px-4 py-2 border-b bg-muted/30 text-xs text-muted-foreground"
      >
        <span>{t('memory.rag-banner.ready', { count: snap.total })}</span>
        <button
          type="button"
          data-testid="rag-progress-banner-dismiss"
          onClick={() => setDoneVisible(false)}
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
