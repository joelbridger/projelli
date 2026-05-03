// Plugin Spike — orchestration harness.
//
// Owns the per-criterion state map and exposes a row of criterion cards plus
// a [Run all] button. Scenario handlers are injected via the `scenarios`
// prop so Group IV can swap in real bridge-driven implementations without
// touching the harness UI. The default behaviour for missing handlers is to
// fail the criterion with "not yet implemented" so the gate is honest.
//
// Spec: docs/superpowers/specs/2026-04-28-v2.0-mega-release-design.md §6.3

import { useCallback, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

import type {
  CriterionId,
  CriterionState,
  HarnessState,
  ScenarioHandler,
  ScenarioMap,
  ScenarioOutcome,
} from './types';
import { SPIKE_CRITERIA, makeIdleState } from './types';

interface SpikeHarnessProps {
  state: HarnessState;
  /** Setter callback invoked whenever any criterion's state changes. */
  onStateChange: (state: HarnessState) => void;
  /** Per-criterion handlers. Missing ids fall back to a "not implemented" failure. */
  scenarios: ScenarioMap;
  className?: string;
}

const NOT_IMPLEMENTED: ScenarioOutcome = {
  status: 'fail',
  details: 'No scenario handler wired (Group IV pending).',
};

function getHandler(scenarios: ScenarioMap, id: CriterionId): ScenarioHandler {
  const wired = scenarios[id];
  if (wired) return wired;
  return async () => NOT_IMPLEMENTED;
}

/**
 * Apply an outcome to a criterion state, preserving prior history fields
 * unless the new outcome explicitly carries them. Avoids losing the previous
 * sidebar spec or timings when a re-run for a different criterion fires.
 */
function applyOutcome(prev: CriterionState | undefined, outcome: ScenarioOutcome): CriterionState {
  const base = prev ?? makeIdleState();
  const next: CriterionState = {
    status: outcome.status,
    details: outcome.details,
  };
  if (outcome.metrics ?? base.metrics) {
    const merged = { ...(base.metrics ?? {}), ...(outcome.metrics ?? {}) };
    if (Object.keys(merged).length > 0) next.metrics = merged;
  }
  if (outcome.sidebarSpec) next.sidebarSpec = outcome.sidebarSpec;
  else if (base.sidebarSpec) next.sidebarSpec = base.sidebarSpec;
  if (outcome.timings) next.timings = outcome.timings;
  else if (base.timings) next.timings = base.timings;
  if (outcome.errorMessage) next.errorMessage = outcome.errorMessage;
  return next;
}

export function SpikeHarness({
  state,
  onStateChange,
  scenarios,
  className,
}: SpikeHarnessProps) {
  // Tracks whether a [Run all] cycle is in progress. Per-card [Run] buttons
  // share this so the user can't spam concurrent runs that race the state map.
  const [busyId, setBusyId] = useState<'all' | CriterionId | null>(null);

  // runOne accepts the current state map as an argument so callers can thread
  // it through a sequential loop without going stale across awaits. The
  // closure over `state` (via `useCallback`) is not safe for [Run all] because
  // each iteration would see the snapshot from when handleRunAll was invoked.
  const runOne = useCallback(
    async (id: CriterionId, current: HarnessState): Promise<HarnessState> => {
      // Mark as running, then await scenario, then commit outcome.
      const runningState = new Map(current);
      runningState.set(id, {
        ...(runningState.get(id) ?? makeIdleState()),
        status: 'running',
        details: 'Running...',
      });
      onStateChange(runningState);

      let outcome: ScenarioOutcome;
      try {
        outcome = await getHandler(scenarios, id)();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        outcome = {
          status: 'fail',
          details: 'Scenario handler threw.',
          errorMessage: message,
        };
      }
      const finalState = new Map(runningState);
      finalState.set(id, applyOutcome(finalState.get(id), outcome));
      onStateChange(finalState);
      return finalState;
    },
    [scenarios, onStateChange],
  );

  const handleRunOne = useCallback(
    async (id: CriterionId) => {
      if (busyId !== null) return;
      setBusyId(id);
      try {
        await runOne(id, state);
      } finally {
        setBusyId(null);
      }
    },
    [busyId, runOne, state],
  );

  const handleRunAll = useCallback(async () => {
    if (busyId !== null) return;
    setBusyId('all');
    try {
      let cursor = state;
      for (const c of SPIKE_CRITERIA) {
        cursor = await runOne(c.id, cursor);
      }
    } finally {
      setBusyId(null);
    }
  }, [busyId, runOne, state]);

  const handleReset = useCallback(() => {
    if (busyId !== null) return;
    const fresh: HarnessState = new Map();
    for (const c of SPIKE_CRITERIA) {
      fresh.set(c.id, makeIdleState());
    }
    onStateChange(fresh);
  }, [busyId, onStateChange]);

  return (
    <div className={cn('flex flex-col gap-3', className)} data-testid="spike-harness">
      <div className="flex items-center gap-2">
        <Button
          onClick={handleRunAll}
          disabled={busyId !== null}
          data-testid="spike-run-all"
        >
          {busyId === 'all' ? 'Running...' : 'Run all'}
        </Button>
        <Button
          variant="outline"
          onClick={handleReset}
          disabled={busyId !== null}
          data-testid="spike-reset"
        >
          Reset
        </Button>
      </div>
      <div className="grid grid-cols-1 gap-2" data-testid="spike-criterion-list">
        {SPIKE_CRITERIA.map((c) => {
          const s = state.get(c.id) ?? makeIdleState();
          const isBusyHere = busyId === c.id || (busyId === 'all' && s.status === 'running');
          return (
            <Card
              key={c.id}
              data-testid={`spike-criterion-${c.id}`}
              data-status={s.status}
              className={cn(
                'transition-colors',
                s.status === 'pass' && 'border-green-500/40',
                s.status === 'fail' && 'border-destructive/40',
              )}
            >
              <CardHeader className="p-3 pb-1.5">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <span className="font-mono text-xs text-muted-foreground">{c.id}</span>
                  {c.title}
                </CardTitle>
                <CardDescription className="text-xs leading-snug">{c.summary}</CardDescription>
              </CardHeader>
              <CardContent className="p-3 pt-1.5 flex items-center justify-between gap-2">
                <span className="text-[11px] text-muted-foreground truncate">
                  {s.details || c.passSignal}
                  {s.errorMessage ? (
                    <span className="text-destructive ml-1 font-mono">
                      ({s.errorMessage})
                    </span>
                  ) : null}
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busyId !== null}
                  onClick={() => {
                    void handleRunOne(c.id);
                  }}
                  data-testid={`spike-run-${c.id}`}
                >
                  {isBusyHere ? '...' : 'Run'}
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
