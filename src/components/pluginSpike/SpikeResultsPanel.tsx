// Plugin Spike — results panel.
//
// Shows live status for all 8 criteria plus a [Copy memo block] button that
// dumps a markdown table fit for paste-into-memo. This is the harness's
// primary evidence surface; the markdown block is what closes the gate.
//
// Spec: docs/superpowers/specs/2026-04-28-v2.0-mega-release-design.md §6.3

import { useCallback, useState } from 'react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

import { PerformanceReport } from './PerformanceReport';
import { SpikeSidebarPreview } from './SpikeSidebarPreview';
import type { CriterionState, HarnessState } from './types';
import { SPIKE_CRITERIA } from './types';

interface SpikeResultsPanelProps {
  state: HarnessState;
  className?: string;
}

function statusGlyph(status: CriterionState['status']): string {
  switch (status) {
    case 'pass':
      return 'PASS';
    case 'fail':
      return 'FAIL';
    case 'running':
      return 'RUN ';
    case 'idle':
    default:
      return ' -- ';
  }
}

function statusBadgeClass(status: CriterionState['status']): string {
  switch (status) {
    case 'pass':
      return 'bg-green-500/15 text-green-600 dark:text-green-400 border-green-500/30';
    case 'fail':
      return 'bg-destructive/15 text-destructive border-destructive/30';
    case 'running':
      return 'bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/30 animate-pulse';
    case 'idle':
    default:
      return 'bg-muted text-muted-foreground border-border';
  }
}

function formatMetrics(metrics: Record<string, number> | undefined): string {
  if (!metrics) return '';
  const entries = Object.entries(metrics);
  if (entries.length === 0) return '';
  return entries
    .map(([k, v]) => `${k}=${typeof v === 'number' ? v.toFixed(2) : String(v)}`)
    .join(' ');
}

export function buildMemoBlock(state: HarnessState): string {
  const lines: string[] = [];
  lines.push('| # | Criterion | Result | Notes |');
  lines.push('|---|---|---|---|');
  for (const c of SPIKE_CRITERIA) {
    const s = state.get(c.id);
    const status = s?.status ?? 'idle';
    const result = status === 'pass' ? 'pass' : status === 'fail' ? 'fail' : 'pending';
    const metrics = formatMetrics(s?.metrics);
    const noteParts: string[] = [];
    if (s?.details) noteParts.push(s.details);
    if (metrics) noteParts.push(metrics);
    if (s?.errorMessage) noteParts.push(`error: ${s.errorMessage}`);
    const notes = noteParts.join(' | ').replace(/\|/g, '\\|') || '...';
    lines.push(`| ${c.id} | ${c.title} | ${result} | ${notes} |`);
  }
  return lines.join('\n');
}

export function SpikeResultsPanel({
  state,
  className,
}: SpikeResultsPanelProps) {
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'error'>('idle');

  const handleCopy = useCallback(async () => {
    const block = buildMemoBlock(state);
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(block);
      } else {
        // jsdom + non-secure-context fallback. Spike harness only; the
        // production app uses navigator.clipboard exclusively.
        const ta = document.createElement('textarea');
        ta.value = block;
        ta.setAttribute('readonly', '');
        ta.style.position = 'absolute';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      setCopyStatus('copied');
      setTimeout(() => setCopyStatus('idle'), 1500);
    } catch {
      setCopyStatus('error');
      setTimeout(() => setCopyStatus('idle'), 1500);
    }
  }, [state]);

  // Pull out the criterion-4 sidebar spec + criterion-8 timings so we can
  // render their rich previews under the table.
  const sidebarSpec = state.get(4)?.sidebarSpec ?? null;
  const timings = state.get(8)?.timings ?? [];

  return (
    <div className={cn('flex flex-col gap-4', className)} data-testid="spike-results-panel">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Results</h2>
        <Button
          variant="outline"
          size="sm"
          onClick={handleCopy}
          data-testid="spike-copy-memo"
        >
          {copyStatus === 'copied'
            ? 'Copied'
            : copyStatus === 'error'
              ? 'Copy failed'
              : 'Copy memo block'}
        </Button>
      </div>
      <ol className="space-y-2" data-testid="spike-results-list">
        {SPIKE_CRITERIA.map((c) => {
          const s = state.get(c.id);
          const status = s?.status ?? 'idle';
          return (
            <li
              key={c.id}
              className="rounded-md border border-border bg-card p-3"
              data-testid={`spike-result-${c.id}`}
              data-status={status}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="font-mono text-xs text-muted-foreground w-4 text-right">
                    {c.id}
                  </span>
                  <span className="font-medium truncate">{c.title}</span>
                </div>
                <span
                  className={cn(
                    'shrink-0 rounded border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider',
                    statusBadgeClass(status),
                  )}
                  aria-label={`status ${status}`}
                >
                  {statusGlyph(status)}
                </span>
              </div>
              {(s?.details || s?.errorMessage) && (
                <div className="mt-1 text-xs text-muted-foreground whitespace-pre-wrap break-words">
                  {s?.details}
                  {s?.errorMessage && (
                    <div className="text-destructive mt-1 font-mono">
                      {s.errorMessage}
                    </div>
                  )}
                </div>
              )}
              {s?.metrics && Object.keys(s.metrics).length > 0 && (
                <div
                  className="mt-1 text-[11px] font-mono text-muted-foreground"
                  data-testid={`spike-result-${c.id}-metrics`}
                >
                  {formatMetrics(s.metrics)}
                </div>
              )}
            </li>
          );
        })}
      </ol>

      <div className="space-y-2">
        <h3 className="text-sm font-medium">Sidebar panel preview (criterion 4)</h3>
        <SpikeSidebarPreview spec={sidebarSpec} />
      </div>

      <div className="space-y-2">
        <h3 className="text-sm font-medium">Round-trip latency (criterion 8)</h3>
        <PerformanceReport durations={timings} />
      </div>
    </div>
  );
}
