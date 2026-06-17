/**
 * Ollama Settings Section (Q7, v1.5 — Flag 4).
 *
 * Shown inside the Integrations settings category (alongside the MCP bundle).
 * Three UI blocks:
 *
 *   1. Status pill — "Ollama ready · N models" / "Ollama not running" /
 *      "Checking...". Auto-detects on mount.
 *   2. Check Connection button — pings `127.0.0.1:11434/api/tags` on demand.
 *   3. Install hint — direct link to https://ollama.com/download when the
 *      daemon isn't reachable.
 *
 * Ollama needs no API key so this section is deliberately simpler than the
 * Claude / OpenAI / Gemini onboarding flow.
 */

import { useCallback, useEffect, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { Button } from '@/ui/button';
import { CheckCircle2, AlertCircle, RefreshCw, ExternalLink } from 'lucide-react';
import { detectOllama } from '@/platform/providers/OllamaProvider';

export interface OllamaSettingsSectionProps {
  /**
   * Override the detection function so tests can stub out the network call.
   * When omitted, uses the real `detectOllama` against `127.0.0.1:11434`.
   */
  onDetect?: () => Promise<{ reachable: boolean; models: string[] }>;
}

type Status = 'checking' | 'ready' | 'unavailable';

export function OllamaSettingsSection({ onDetect }: OllamaSettingsSectionProps = {}): React.ReactElement {
  const { t } = useTranslation();
  const [status, setStatus] = useState<Status>('checking');
  const [models, setModels] = useState<string[]>([]);

  const doDetect = useCallback(async () => {
    setStatus('checking');
    const result = await (onDetect ? onDetect() : detectOllama());
    if (result.reachable) {
      setStatus('ready');
      setModels(result.models);
    } else {
      setStatus('unavailable');
      setModels([]);
    }
  }, [onDetect]);

  useEffect(() => {
    void doDetect();
  }, [doDetect]);

  return (
    <div data-testid="ollama-settings-section" className="space-y-4 pt-6 mt-6 border-t border-border">
      <div>
        <h3 className="text-base font-semibold">{t('settings.ollama.title')}</h3>
        <p className="text-xs text-muted-foreground mt-1">
          <Trans
            i18nKey="settings.ollama.description"
            components={{ c: <code className="px-1 mx-1 rounded bg-muted font-mono text-[11px]" /> }}
          />
        </p>
      </div>

      <div
        data-testid="ollama-status"
        data-status={status}
        className="flex items-center gap-2 rounded-md border border-border/60 bg-muted/20 px-3 py-2"
      >
        {status === 'checking' ? (
          <>
            <RefreshCw className="h-4 w-4 text-muted-foreground shrink-0 animate-spin" />
            <span className="text-sm text-muted-foreground">{t('settings.ollama.status.checking')}</span>
          </>
        ) : status === 'ready' ? (
          <>
            <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
            <span className="text-sm">
              {t('settings.ollama.status.ready', { count: models.length })}
              {models.length > 0 && (
                <span className="text-muted-foreground ml-1">
                  ({models.slice(0, 3).join(', ')}
                  {models.length > 3 ? t('settings.ollama.status.more-suffix', { count: models.length - 3 }) : ''})
                </span>
              )}
            </span>
          </>
        ) : (
          <>
            <AlertCircle className="h-4 w-4 text-amber-500 shrink-0" />
            <span className="text-sm">
              {t('settings.ollama.status.not-running')}
            </span>
          </>
        )}
      </div>

      <div className="flex items-center gap-2">
        <Button
          data-testid="ollama-check-connection"
          onClick={() => {
            void doDetect();
          }}
          disabled={status === 'checking'}
          variant="default"
          size="sm"
          className="gap-1.5 text-xs"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${status === 'checking' ? 'animate-spin' : ''}`} />
          {t('settings.ollama.check-cta')}
        </Button>
        {status === 'unavailable' && (
          <a
            href="https://ollama.com/download"
            target="_blank"
            rel="noreferrer"
            className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
          >
            {t('settings.ollama.install-link')} <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </div>

      {status === 'ready' && models.length === 0 && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
          <Trans
            i18nKey="settings.ollama.no-models-hint"
            components={{ c: <code className="px-1 mx-1 rounded bg-muted font-mono text-[11px]" /> }}
          />
        </div>
      )}

      <div className="rounded-md border border-border/60 p-3 text-xs leading-relaxed text-muted-foreground space-y-2">
        <p className="font-medium text-foreground">{t('settings.ollama.why.heading')}</p>
        <ul className="list-disc list-inside space-y-1">
          <li>{t('settings.ollama.why.zero-cost')}</li>
          <li>{t('settings.ollama.why.zero-network')}</li>
          <li>{t('settings.ollama.why.zero-data')}</li>
        </ul>
        <p className="pt-1">
          <Trans
            i18nKey="settings.ollama.recommended-model"
            components={{ c: <code className="px-1 mx-1 rounded bg-muted font-mono text-[11px]" /> }}
          />
        </p>
      </div>
    </div>
  );
}

export default OllamaSettingsSection;
