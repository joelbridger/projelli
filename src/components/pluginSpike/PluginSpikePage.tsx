// Plugin Spike — top-level page mounted at `/_dev/plugin-spike`.
//
// Gated behind `import.meta.env.DEV` OR `localStorage.getItem('projelli:spike') === '1'`,
// so it never renders in a stock production build. Layout: 8 criterion cards
// in the left column, results panel + previews in the right column.
//
// Group IV will populate the `scenarios` map with real bridge-driven
// implementations. For now the page passes an empty map so every criterion
// reports "not yet implemented" as a deliberate failure signal.
//
// Spec: docs/superpowers/specs/2026-04-28-v2.0-mega-release-design.md §6.3

import { useMemo, useState } from 'react';

import { cn } from '@/lib/utils';
import { SpikeAPIBridge, type SpikeWorkerLike } from '@/modules/pluginSpike/SpikeAPIBridge';
import { buildScenarios } from '@/modules/pluginSpike/scenarios';
import SpikeWorker from '@/modules/pluginSpike/spike-worker.ts?worker';

import { SpikeHarness } from './SpikeHarness';
import { SpikeResultsPanel } from './SpikeResultsPanel';
import type { HarnessState, ScenarioMap } from './types';
import { SPIKE_CRITERIA, makeIdleState } from './types';

const SPIKE_LOCALSTORAGE_KEY = 'projelli:spike';
const SPIKE_ROUTE = '/_dev/plugin-spike';

/**
 * Returns true if the spike route should be active. Either the build is a
 * dev build (Vite `import.meta.env.DEV`) OR a per-machine opt-in flag is set
 * in localStorage. The opt-in flag exists so a packaged build can still
 * surface the spike for verification on the same hardware that will run the
 * production runner; this is a deliberate spike-only escape hatch.
 */
export function isSpikeEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  if (import.meta.env.DEV) return true;
  try {
    return window.localStorage.getItem(SPIKE_LOCALSTORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * Returns true if the current location matches the spike route. Used by
 * App.tsx to decide whether to short-circuit the workspace UI.
 */
export function isSpikeRoute(): boolean {
  if (typeof window === 'undefined') return false;
  // Match either pathname or hash so this works regardless of how the dev
  // build is served (vite + Tauri webview both expose pathname; static
  // hosting fallback uses hash routes).
  const path = window.location.pathname || '';
  const hash = window.location.hash || '';
  return path === SPIKE_ROUTE || hash === `#${SPIKE_ROUTE}`;
}

interface PluginSpikePageProps {
  /** Override scenarios for tests. Defaults to empty (Group IV pending). */
  scenarios?: ScenarioMap;
  className?: string;
}

function makeInitialState(): HarnessState {
  const m: HarnessState = new Map();
  for (const c of SPIKE_CRITERIA) {
    m.set(c.id, makeIdleState());
  }
  return m;
}

export function PluginSpikePage({
  scenarios,
  className,
}: PluginSpikePageProps) {
  const [state, setState] = useState<HarnessState>(() => makeInitialState());
  const wiredScenarios = useMemo<ScenarioMap>(() => {
    if (scenarios) return scenarios;
    return buildScenarios({
      makeBridge: (manifest, hooks) =>
        new SpikeAPIBridge({
          manifest,
          workerFactory: () => new SpikeWorker() as unknown as SpikeWorkerLike,
          onRegisterCommand: hooks.onRegisterCommand,
        }),
    });
  }, [scenarios]);

  return (
    <div
      className={cn(
        'min-h-screen bg-background text-foreground p-6',
        className,
      )}
      data-testid="plugin-spike-page"
    >
      <header className="mb-4 flex items-baseline justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Plugin Runner Sandbox Spike</h1>
          <p className="text-sm text-muted-foreground">
            Stream C2 hidden harness. Validates 8 spike criteria from spec section 6.3.
          </p>
        </div>
        <code className="text-xs text-muted-foreground font-mono">{SPIKE_ROUTE}</code>
      </header>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <section data-testid="spike-harness-column">
          <SpikeHarness
            state={state}
            onStateChange={setState}
            scenarios={wiredScenarios}
          />
        </section>
        <section data-testid="spike-results-column">
          <SpikeResultsPanel state={state} />
        </section>
      </div>
    </div>
  );
}
