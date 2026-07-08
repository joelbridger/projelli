/**
 * LocalAiSettingsControl — the user-facing "Download Lantern Local AI" control.
 *
 * This is the opt-in trigger for the embedded, fully-offline AI engine. It lives
 * in Settings → AI (and is mirrored in onboarding). The 2.4 GB model is never
 * downloaded automatically; the user starts it here. Progress is also surfaced
 * app-wide by LocalAiDownloadCard so the user can navigate away while it runs.
 *
 * States: absent → a Download button; checking/downloading/verifying → progress;
 * ready → an "installed and ready" confirmation; error → a Resume button.
 */

import { useTranslation } from 'react-i18next';
import { Cpu, Download, Loader2 } from 'lucide-react';
import { InfoHelp } from '@/ui/InfoHelp';
import { QuietStatus } from '@/ui/kp';
import { useLocalLlmModelStatus } from '@/platform/hooks/useLocalLlmModelStatus';

export interface LocalAiSettingsControlProps {
  /** Override the live hook for tests. */
  status?: ReturnType<typeof useLocalLlmModelStatus>;
}

export function LocalAiSettingsControl({ status }: LocalAiSettingsControlProps) {
  const { t } = useTranslation();
  const live = useLocalLlmModelStatus();
  const snap = status ?? live;

  // Off-desktop (browser / unprobed) the engine isn't available — render nothing
  // rather than a dead button.
  if (snap.state === 'idle') return null;

  if (snap.state === 'ready') {
    return (
      <QuietStatus
        data-testid="local-ai-settings"
        data-state={snap.state}
        className="mt-2"
      >
        <span data-testid="local-ai-ready">{t('local-ai-settings.ready')}</span>
      </QuietStatus>
    );
  }

  const downloading =
    snap.state === 'checking' ||
    snap.state === 'downloading' ||
    snap.state === 'verifying';
  const pct =
    snap.bytesTotal && snap.bytesTotal > 0
      ? Math.min(100, Math.round((snap.bytesDone / snap.bytesTotal) * 100))
      : 0;

  return (
    <div
      data-testid="local-ai-settings"
      data-state={snap.state}
      className="rounded-lg border bg-card p-4 text-sm"
    >
      <div className="flex items-start gap-3">
        <Cpu className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 font-medium text-foreground">
            <span>{t('local-ai-settings.title')}</span>
            <InfoHelp
              content={t('local-ai-settings.description')}
              label={`About ${t('local-ai-settings.title')}`}
            />
          </div>

          {snap.state === 'absent' && (
            <button
              type="button"
              data-testid="local-ai-download-button"
              onClick={snap.start}
              className="mt-3 inline-flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
            >
              <Download className="h-3.5 w-3.5" />
              {t('local-ai-settings.download')}
            </button>
          )}

          {downloading && (
            <div className="mt-3" data-testid="local-ai-download-progress">
              <div className="flex items-center gap-2 text-xs text-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                {snap.state === 'verifying'
                  ? t('local-ai-settings.verifying')
                  : t('local-ai-settings.downloading', { pct })}
              </div>
              <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded bg-muted">
                <div
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={pct}
                  className="h-full rounded bg-primary transition-[width]"
                  style={{ width: `${String(pct)}%` }}
                />
              </div>
            </div>
          )}

          {snap.state === 'error' && (
            <div className="mt-3">
              <div className="text-xs text-destructive">
                {t('local-ai-settings.error')}
                {snap.message ? ` (${snap.message})` : ''}
              </div>
              <button
                type="button"
                data-testid="local-ai-retry-button"
                onClick={snap.retry}
                className="mt-2 inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted"
              >
                <Download className="h-3.5 w-3.5" />
                {t('local-ai-settings.retry')}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
