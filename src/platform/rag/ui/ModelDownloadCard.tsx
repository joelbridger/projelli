/**
 * ModelDownloadCard — slim non-modal banner for the one-time embedding
 * model download (Option B). Sits next to RagProgressBanner in the
 * workspace shell.
 *
 * Visibility rule:
 *   - checking / downloading / verifying → progress banner
 *   - stalled (no progress event for 90s mid-transfer) → the body line
 *     switches to the stalled copy; the progress bar stays; NO Resume
 *     button (on a true TCP hang `model_ensure` returns "downloading"
 *     via the single-flight guard without emitting events, so Resume
 *     would only reset the stall window — restarting the app is the
 *     honest remedy)
 *   - error → error banner with a Resume button (hf-hub resumes the
 *     partial file via HTTP Range, so "Resume" is honest)
 *   - idle / ready → renders nothing
 */

import { useTranslation } from 'react-i18next';
import { useModelStatus } from '@/hooks/useModelStatus';

export interface ModelDownloadCardProps {
  /** Override the live hook for tests. */
  status?: ReturnType<typeof useModelStatus>;
}

const MB = 1024 * 1024;

export function ModelDownloadCard({ status }: ModelDownloadCardProps) {
  const { t } = useTranslation();
  const live = useModelStatus();
  const snap = status ?? live;

  if (
    snap.state === 'idle' ||
    snap.state === 'ready'
  ) {
    return null;
  }

  if (snap.state === 'error') {
    return (
      <div
        data-testid="model-download-card"
        role="status"
        aria-live="polite"
        className="flex items-center gap-3 px-4 py-2 border-b bg-destructive/10 text-xs"
      >
        <div className="flex-1 min-w-0">
          <div className="font-medium text-foreground">
            {t('model-download.error-title')}
          </div>
          <div className="text-muted-foreground truncate">
            {t('model-download.error-body')}
            {snap.message ? ` (${snap.message})` : ''}
          </div>
        </div>
        <button
          type="button"
          onClick={snap.retry}
          className="shrink-0 rounded border px-2 py-1 font-medium text-foreground hover:bg-muted"
        >
          {t('model-download.retry')}
        </button>
      </div>
    );
  }

  const doneMb = Math.floor(snap.bytesDone / MB);
  const totalMb = snap.bytesTotal ? Math.ceil(snap.bytesTotal / MB) : null;
  const pct =
    snap.bytesTotal && snap.bytesTotal > 0
      ? Math.min(100, Math.round((snap.bytesDone / snap.bytesTotal) * 100))
      : null;

  return (
    <div
      data-testid="model-download-card"
      role="status"
      aria-live="polite"
      className="flex items-center gap-3 px-4 py-2 border-b bg-muted/40 text-xs"
    >
      <div className="flex-1 min-w-0">
        <div className="font-medium text-foreground">
          {t('model-download.title')}
          {/* aria-hidden: the percent ticks on every progress event; the
              progressbar's aria-valuenow already exposes it, so keep it
              out of the polite live region to avoid re-announcing the
              whole banner every ~4MB. */}
          {pct !== null ? (
            <span aria-hidden="true">{` (${pct}%)`}</span>
          ) : null}
        </div>
        <div className="text-muted-foreground">
          {snap.stalled
            ? t('model-download.stalled')
            : snap.state === 'verifying'
              ? t('model-download.verifying')
              : t('model-download.body')}
        </div>
        <div
          role="progressbar"
          aria-label={t('model-download.title')}
          aria-valuemin={0}
          aria-valuemax={100}
          {...(pct !== null ? { 'aria-valuenow': pct } : {})}
          className="mt-1 h-1.5 w-full overflow-hidden rounded bg-muted"
        >
          {/* Indeterminate (unknown total): dimmed pulsing full-width fill,
              not a solid bar that would visibly "drain" once the first real
              total arrives. transition-[width] only when determinate. */}
          <div
            className={
              pct !== null
                ? 'h-full rounded bg-primary transition-[width]'
                : 'h-full rounded bg-primary animate-pulse opacity-40'
            }
            style={{ width: pct !== null ? `${pct}%` : '100%' }}
          />
        </div>
        {/* aria-live="off": the MB counter changes on every chunk; without
            it the polite region above would re-announce for minutes.
            Suppressed entirely when verifying an unknown total — "0 MB so
            far" right after a finished download reads as a regression. */}
        {!(snap.state === 'verifying' && totalMb === null) && (
          <div aria-live="off" className="mt-0.5 text-muted-foreground">
            {totalMb !== null
              ? t('model-download.progress', { done: doneMb, total: totalMb })
              : t('model-download.progress-unknown', { done: doneMb })}
          </div>
        )}
      </div>
    </div>
  );
}
