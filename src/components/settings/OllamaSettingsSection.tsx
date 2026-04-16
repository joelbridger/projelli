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
import { Button } from '@/components/ui/button';
import { CheckCircle2, AlertCircle, RefreshCw, ExternalLink } from 'lucide-react';
import { detectOllama } from '@/modules/models/OllamaProvider';

export interface OllamaSettingsSectionProps {
  /**
   * Override the detection function so tests can stub out the network call.
   * When omitted, uses the real `detectOllama` against `127.0.0.1:11434`.
   */
  onDetect?: () => Promise<{ reachable: boolean; models: string[] }>;
}

type Status = 'checking' | 'ready' | 'unavailable';

export function OllamaSettingsSection({ onDetect }: OllamaSettingsSectionProps = {}): React.ReactElement {
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
        <h3 className="text-base font-semibold">Ollama (local models)</h3>
        <p className="text-xs text-muted-foreground mt-1">
          Run AI models directly on your machine — free, offline, private.
          Projelli talks to a locally running Ollama daemon on
          <code className="px-1 mx-1 rounded bg-muted font-mono text-[11px]">127.0.0.1:11434</code>.
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
            <span className="text-sm text-muted-foreground">Checking Ollama...</span>
          </>
        ) : status === 'ready' ? (
          <>
            <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
            <span className="text-sm">
              Ollama ready &middot; {models.length} model{models.length === 1 ? '' : 's'} installed
              {models.length > 0 && (
                <span className="text-muted-foreground ml-1">
                  ({models.slice(0, 3).join(', ')}
                  {models.length > 3 ? `, +${models.length - 3} more` : ''})
                </span>
              )}
            </span>
          </>
        ) : (
          <>
            <AlertCircle className="h-4 w-4 text-amber-500 shrink-0" />
            <span className="text-sm">
              Ollama not running. Install it to run AI models locally, free.
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
          Check Ollama connection
        </Button>
        {status === 'unavailable' && (
          <a
            href="https://ollama.com/download"
            target="_blank"
            rel="noreferrer"
            className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
          >
            Install Ollama <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </div>

      {status === 'ready' && models.length === 0 && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
          Ollama is running but no models are installed. Pull one with
          <code className="px-1 mx-1 rounded bg-muted font-mono text-[11px]">ollama pull llama3.2:3b</code>
          and click Check again.
        </div>
      )}

      <div className="rounded-md border border-border/60 p-3 text-xs leading-relaxed text-muted-foreground space-y-2">
        <p className="font-medium text-foreground">Why Ollama?</p>
        <ul className="list-disc list-inside space-y-1">
          <li>Zero cost. Inference runs on your GPU / CPU.</li>
          <li>Zero network. Works on a plane, offline, in a tunnel.</li>
          <li>Zero data sharing. Your prompts never leave the machine.</li>
        </ul>
        <p className="pt-1">
          Recommended first model:
          <code className="px-1 mx-1 rounded bg-muted font-mono text-[11px]">llama3.2:3b</code>
          (about 2 GB, runs on almost any laptop).
        </p>
      </div>
    </div>
  );
}

export default OllamaSettingsSection;
