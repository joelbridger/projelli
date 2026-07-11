// Q15 — "Run on all" button + comparison panel orchestration.
//
// A paid-tier-only control that fires the same user prompt to every
// configured provider in parallel, streams each result into a
// ComparisonView, computes agreement score + contradiction count via
// ContradictionDetector, and lets the user promote one output back into
// the canonical chat via `onKeep`.
//
// Design notes:
//   - Uses `Promise.allSettled` so a failed provider doesn't block the rest.
//   - Surfaces total cost under the comparison view.
//   - Requires 2+ DIFFERENT providers configured (Ollama-only setups are
//     disallowed per the Phase 5 spec).

import { useCallback, useMemo, useRef, useState } from 'react';
import {
  assertCloudGenerationAllowed,
  ConfidentialityChoiceRequiredError,
  assertLocalOnlyAllowsExternal,
  LocalOnlyExternalError,
  isLocalOnlyModeFailClosed,
} from '@/platform/privacy/localOnlyGuard';
import { useConfidentialityMode } from '@/platform/hooks/useConfidentialityMode';
import { sendWithEgressAudit } from '@/platform/privacy/sendWithEgressAudit';
import { useTranslation } from 'react-i18next';
import { Button } from '@/ui/button';
import { Card, CardContent } from '@/ui/card';
import { Sparkles, Loader2, X, CheckCircle2 } from 'lucide-react';
import type { Provider } from '@/platform/providers/Provider';
import { ComparisonView } from '@/platform/analysis/ui/ComparisonView';
import { tierHasFeature, type LicenseTier } from '@/platform/hooks/useLicense';
import {
  ContradictionDetector,
  type ContradictionAnalysis,
} from '@/platform/analysis/ContradictionDetector';

export interface ConfiguredProvider {
  /** Stable id for keying testids, e.g. "claude" / "openai" / "gemini". */
  id: string;
  /** Human-readable label. */
  label: string;
  provider: Provider;
}

export interface RunOnAllButtonProps {
  tier: LicenseTier;
  providers: ConfiguredProvider[];
  /** Prompt currently in the input. Disabled when empty. */
  prompt: string;
  /** Called when the user clicks "Keep this one" under a column. */
  onKeep?: (providerId: string, content: string) => void;
  /** Provider used to detect contradictions after all outputs arrive. */
  analysisProvider?: Provider;
}

interface PerProviderResult {
  providerId: string;
  label: string;
  content: string;
  cost: number;
  tokens: number;
  latency: number;
  error?: string;
}

export function RunOnAllButton({
  tier,
  providers,
  prompt,
  onKeep,
  analysisProvider,
}: RunOnAllButtonProps) {
  const [results, setResults] = useState<PerProviderResult[] | null>(null);
  const [analysis, setAnalysis] = useState<ContradictionAnalysis | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  // QA-59: the contradiction analysis fires AFTER results render (a slower,
  // second cloud call). If the user starts a new comparison before an earlier
  // analysis returns, its late setAnalysis would attach to the WRONG (current)
  // comparison. A per-run token, bumped at the start of every run, lets us drop
  // any analysis whose run has since been superseded.
  const runTokenRef = useRef(0);

  const hasComparison = tierHasFeature(tier, 'multi-model-comparison');
  // Local-only kill-switch: "Run on all" is inherently a CLOUD fan-out (it
  // excludes ollama and compares 2+ cloud providers), so it must be unavailable
  // when "nothing leaves" is selected. Reactive so the button reacts to the mode.
  const localOnly = useConfidentialityMode() === 'local-only';
  const distinctProviderIds = useMemo(
    () => new Set(providers.map((p) => p.id).filter((id) => id !== 'ollama')),
    [providers],
  );
  const canRun = hasComparison && distinctProviderIds.size >= 2 && prompt.trim().length > 0 && !localOnly;

  const runAll = useCallback(async () => {
    const token = ++runTokenRef.current;
    setIsRunning(true);
    setAnalysis(null);
    setResults(null);
    const active = providers.filter((p) => distinctProviderIds.has(p.id));

    // Personal-install choice gate (Task 1.3 fix): "Run on all" is cloud generation
    // (distinctProviderIds already excludes 'ollama'). Block until the user has made
    // an explicit confidentiality choice. Surface as per-provider error rows so the
    // comparison panel renders a clear message rather than a blank screen.
    try {
      // Local-only kill-switch (last line, no await before the fan-out below):
      // never run a cloud comparison when "nothing leaves" is on, even if the
      // mode flipped after the button was enabled.
      assertLocalOnlyAllowsExternal('Run on all models');
      assertCloudGenerationAllowed();
    } catch (gateErr) {
      const msg =
        gateErr instanceof LocalOnlyExternalError || gateErr instanceof ConfidentialityChoiceRequiredError
          ? gateErr.message
          : 'Cloud generation is not allowed yet.';
      setResults(
        active.map((p) => ({
          providerId: p.id,
          label: p.label,
          content: '',
          cost: 0,
          tokens: 0,
          latency: 0,
          error: msg,
        })),
      );
      setIsRunning(false);
      return;
    }

    const settled = await Promise.allSettled(
      active.map(async (p) => {
        const started = Date.now();
        const response = await sendWithEgressAudit({
          provider: p.provider,
          providerId: p.id,
          model: p.provider.getMetadata().model,
          prompt,
          // runAll has just made the equivalent fail-closed check above; each
          // cloud adapter also checks again immediately before its request.
          preflightChecked: true,
          modelCall: {
            description: `Run on all request to ${p.label}`,
            inputs: { promptLength: prompt.length },
            outputs: (modelResponse) => ({ contentLength: modelResponse.content.length }),
            metadata: { feature: 'run_on_all', providerLabel: p.label },
          },
        });
        return {
          providerId: p.id,
          label: p.label,
          content: response.content,
          cost: response.cost,
          tokens: response.usage.totalTokens,
          latency: Date.now() - started,
        } as PerProviderResult;
      })
    );

    const out: PerProviderResult[] = active.map((p, i) => {
      const s = settled[i];
      if (s && s.status === 'fulfilled') return s.value;
      const reason = s && s.status === 'rejected' ? s.reason : 'Unknown error';
      return {
        providerId: p.id,
        label: p.label,
        content: '',
        cost: 0,
        tokens: 0,
        latency: 0,
        error: reason instanceof Error ? reason.message : String(reason),
      };
    });
    setResults(out);
    setIsRunning(false);

    // Fire-and-forget contradiction analysis if the caller gave us a provider.
    // SECOND cloud call after the fan-out awaits — skip entirely in private mode
    // so the comparison outputs are never sent to a cloud AI for analysis.
    if (analysisProvider && !isLocalOnlyModeFailClosed()) {
      const outputs = out
        .filter((r) => !r.error && r.content)
        .map((r) => ({ source: r.label, text: r.content }));
      if (outputs.length >= 2) {
        try {
          const detector = new ContradictionDetector(analysisProvider);
          const [a, b] = outputs;
          if (a && b) {
            const analysis = await detector.detect(a.text, a.source, b.text, b.source);
            // Drop if a newer comparison has since started (QA-59) — never
            // attach this run's analysis to a later comparison's results.
            if (token !== runTokenRef.current) return;
            setAnalysis(analysis);
          }
        } catch {
          // Silently skip analysis failures.
        }
      }
    }
  }, [prompt, providers, analysisProvider, distinctProviderIds]);

  const totalCost = (results ?? []).reduce((sum, r) => sum + r.cost, 0);

  return (
    <div>
      <Button
        data-testid="run-on-all-button"
        size="icon"
        variant="outline"
        className="h-[60px] w-[60px]"
        onClick={runAll}
        disabled={!canRun || isRunning}
        title={
          localOnly
            ? 'Off while "On this computer only" is selected — this compares cloud providers over the network.'
            : !hasComparison
              ? 'Run on all 3 providers (paid license)'
              : distinctProviderIds.size < 2
                ? 'Requires 2+ providers configured'
                : 'Run this prompt on every configured provider'
        }
      >
        {isRunning ? (
          <Loader2 className="h-5 w-5 animate-spin" />
        ) : (
          <Sparkles className="h-5 w-5" />
        )}
      </Button>

      {results && (
        <RunOnAllResults
          results={results}
          analysis={analysis}
          totalCost={totalCost}
          onKeep={onKeep}
          onDismiss={() => setResults(null)}
        />
      )}
    </div>
  );
}

interface RunOnAllResultsProps {
  results: PerProviderResult[];
  analysis: ContradictionAnalysis | null;
  totalCost: number;
  onKeep?: ((providerId: string, content: string) => void) | undefined;
  onDismiss: () => void;
}

function RunOnAllResults({
  results,
  analysis,
  totalCost,
  onKeep,
  onDismiss,
}: RunOnAllResultsProps) {
  const { t } = useTranslation();
  return (
    <div data-testid="run-on-all-panel" className="mt-3 border rounded bg-background">
      <div className="flex items-center justify-between px-3 py-2 border-b">
        <div className="flex items-center gap-2 text-sm font-medium">
          <CheckCircle2 className="h-4 w-4 text-green-600" />
          {t('chat.run-on-all.title', { count: results.length })}
        </div>
        <button
          data-testid="run-on-all-close"
          className="text-muted-foreground hover:text-foreground"
          onClick={onDismiss}
          aria-label="Close comparison"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="p-2">
        <ComparisonView
          outputs={results.map((r) => ({
            model: r.label + (r.error ? ' (failed)' : ''),
            content: r.error ? `Error: ${r.error}` : r.content,
            metadata: {
              tokens: r.tokens,
              cost: r.cost,
              latency: r.latency,
            },
          }))}
          {...(analysis ? { analysis } : {})}
        />
      </div>

      {/* Per-column "Keep this one" actions */}
      <div className="grid gap-2 p-2 border-t" style={{ gridTemplateColumns: `repeat(${results.length}, 1fr)` }}>
        {results.map((r) => (
          <Button
            key={r.providerId}
            data-testid={`comparison-keep-${r.providerId}`}
            size="sm"
            variant="outline"
            disabled={!!r.error || !r.content}
            onClick={() => onKeep?.(r.providerId, r.content)}
          >
            Keep {r.label}
          </Button>
        ))}
      </div>

      <Card className="border-t rounded-none bg-muted/40">
        <CardContent className="py-2 text-xs text-muted-foreground flex items-center justify-end">
          <span data-testid="run-on-all-total-cost">
            Total cost: ${totalCost.toFixed(4)}
          </span>
        </CardContent>
      </Card>
    </div>
  );
}

export default RunOnAllButton;
