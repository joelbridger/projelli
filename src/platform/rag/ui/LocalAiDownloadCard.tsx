/**
 * LocalAiDownloadCard — slim non-modal progress banner for the OPT-IN Lantern
 * Local AI model download. Mirrors ModelDownloadCard (the e5 search model), but
 * progress-only: it renders NOTHING when the model is absent/idle/ready, so the
 * big optional download never nags. The opt-in trigger lives in Settings /
 * onboarding; this banner only surfaces progress once a transfer is underway so
 * the user can keep working and still see it advance.
 *
 * Visibility rule:
 *   - checking / downloading / verifying → progress banner
 *   - stalled (no progress event for 90s mid-transfer) → stalled copy; bar stays
 *   - error → error banner with a Resume button (Range-resumes the partial file)
 *   - idle / absent / ready → renders nothing
 */

import { useTranslation } from 'react-i18next';
import { useLocalLlmModelStatus } from '@/platform/hooks/useLocalLlmModelStatus';

export interface LocalAiDownloadCardProps {
  /** Override the live hook for tests. */
  status?: ReturnType<typeof useLocalLlmModelStatus>;
}

const MB = 1024 * 1024;

export function LocalAiDownloadCard({ status }: LocalAiDownloadCardProps) {
  const { t } = useTranslation();
  const live = useLocalLlmModelStatus();
  const snap = status ?? live;

  if (snap.state === 'idle' || snap.state === 'absent' || snap.state === 'ready') {
    return null;
  }

  if (snap.state === 'error') {
    return (
      <div
        data-testid="local-ai-download-card"
        role="status"
        aria-live="polite"
        className="flex items-center gap-3 px-4 py-2 border-b bg-destructive/10 text-xs"
      >
        <div className="flex-1 min-w-0">
          <div className="font-medium text-foreground">
            {t('local-ai-download.error-title')}
          </div>
          <div className="text-muted-foreground truncate">
            {t('local-ai-download.error-body')}
            {snap.message ? ` (${snap.message})` : ''}
          </div>
        </div>
        <button
          type="button"
          onClick={snap.retry}
          className="shrink-0 rounded border px-2 py-1 font-medium text-foreground hover:bg-muted"
        >
          {t('local-ai-download.retry')}
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
      data-testid="local-ai-download-card"
      role="status"
      aria-live="polite"
      className="flex items-center gap-3 px-4 py-2 border-b bg-muted/40 text-xs"
    >
      <div className="flex-1 min-w-0">
        <div className="font-medium text-foreground">
          {t('local-ai-download.title')}
          {pct !== null ? <span aria-hidden="true">{` (${String(pct)}%)`}</span> : null}
        </div>
        <div className="text-muted-foreground">
          {snap.stalled
            ? t('local-ai-download.stalled')
            : snap.state === 'verifying'
              ? t('local-ai-download.verifying')
              : t('local-ai-download.body')}
        </div>
        <div
          role="progressbar"
          aria-label={t('local-ai-download.title')}
          aria-valuemin={0}
          aria-valuemax={100}
          {...(pct !== null ? { 'aria-valuenow': pct } : {})}
          className="mt-1 h-1.5 w-full overflow-hidden rounded bg-muted"
        >
          <div
            className={
              pct !== null
                ? 'h-full rounded bg-primary transition-[width]'
                : 'h-full rounded bg-primary animate-pulse opacity-40'
            }
            style={{ width: pct !== null ? `${String(pct)}%` : '100%' }}
          />
        </div>
        {!(snap.state === 'verifying' && totalMb === null) && (
          <div aria-live="off" className="mt-0.5 text-muted-foreground">
            {totalMb !== null
              ? t('local-ai-download.progress', { done: doneMb, total: totalMb })
              : t('local-ai-download.progress-unknown', { done: doneMb })}
          </div>
        )}
      </div>
    </div>
  );
}
