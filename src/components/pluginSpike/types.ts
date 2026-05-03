// Plugin Spike harness — UI-side types.
//
// The harness UI is decoupled from per-criterion scenarios (Group IV). A
// scenario is just an async function that returns a `SpikeResult`. The
// harness owns state, layout, and orchestration. Group IV plugs in real
// handlers; until then the page wires placeholders.
//
// Spec: docs/superpowers/specs/2026-04-28-v2.0-mega-release-design.md §6.3
// Plan: docs/superpowers/plans/2026-05-03-stream-c2-plugin-spike.md

import type { SpikePanelSpec, SpikeResult } from '@/types/pluginSpike';

export type CriterionId = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

/** Stable list of the 8 spike criteria the harness exposes. */
export interface CriterionDescriptor {
  id: CriterionId;
  title: string;
  /** One-line summary shown on the criterion card. */
  summary: string;
  /** Pass-signal description used in the memo block. */
  passSignal: string;
}

export const SPIKE_CRITERIA: ReadonlyArray<CriterionDescriptor> = [
  {
    id: 1,
    title: 'Worker isolation',
    summary: 'Plugin runs in a web worker, isolated from the main thread.',
    passSignal: '`typeof document` and `typeof window` are `undefined` inside the worker.',
  },
  {
    id: 2,
    title: 'Round-trip command',
    summary: 'Plugin registers a command. Main invokes. Result returned across boundary.',
    passSignal: 'Round-trip works for both `void` and `string` returns.',
  },
  {
    id: 3,
    title: 'Permission denial',
    summary: 'Plugin attempting filesystem access without permission FAILS gracefully.',
    passSignal: 'Bridge denies the call; plugin promise rejects with structured error; no crash.',
  },
  {
    id: 4,
    title: 'Sidebar panel render',
    summary: 'Plugin renders a sidebar panel via structured message + main-thread renderer.',
    passSignal: 'Worker emits `panel-render`; main mounts a React subtree wrapping the spec.',
  },
  {
    id: 5,
    title: 'Hot-load + unload',
    summary: 'Plugin loaded at runtime, reloaded after edit, unloaded cleanly.',
    passSignal: 'Worker terminate + URL.revokeObjectURL on unload; no leaked workers.',
  },
  {
    id: 6,
    title: 'Permission enforcement across plugins',
    summary: 'Two plugins, one with permission and one without. Same call: first succeeds, second fails.',
    passSignal: 'Permitted plugin succeeds; denied plugin fails with `permission-denied`.',
  },
  {
    id: 7,
    title: 'Crash isolation',
    summary: "Plugin crash doesn't crash Projelli.",
    passSignal: 'Synchronous + Promise throws are caught; main-thread heartbeat keeps ticking.',
  },
  {
    id: 8,
    title: 'API round-trip latency',
    summary: 'API call round-trip under 50ms typical.',
    passSignal: '100 round-trips of `getSelection`. Median + p95 + max reported.',
  },
] as const;

/**
 * Status used by the harness state machine. Independent of `SpikeResult`'s
 * `status` so we can also represent "not yet attempted" cleanly.
 */
export type CriterionStatus = SpikeResult['status'];

export interface CriterionState {
  status: CriterionStatus;
  details: string;
  metrics?: Record<string, number>;
  /** Optional sidebar spec captured from the worker for criterion #4 preview. */
  sidebarSpec?: SpikePanelSpec;
  /** Optional raw timings array for criterion #8 histogram. */
  timings?: number[];
  /** Last error message, if any. */
  errorMessage?: string;
}

export type HarnessState = Map<CriterionId, CriterionState>;

/**
 * Output of running a scenario. Mirrors `SpikeResult` plus optional carriers
 * for the sidebar spec (criterion #4) and round-trip timings (criterion #8).
 */
export interface ScenarioOutcome {
  status: Exclude<CriterionStatus, 'idle' | 'running'>;
  details: string;
  metrics?: Record<string, number>;
  sidebarSpec?: SpikePanelSpec;
  timings?: number[];
  errorMessage?: string;
}

/**
 * Scenario handler signature. Group IV wires real implementations against
 * `SpikeAPIBridge`; until then the page passes a placeholder that returns
 * `{ status: 'fail', details: 'not yet implemented' }`.
 *
 * Handlers receive nothing — they construct their own bridge instances as
 * needed. This keeps the harness ignorant of bridge wiring details and makes
 * it trivial to swap in real-Worker vs mock-Worker variants for tests.
 */
export type ScenarioHandler = () => Promise<ScenarioOutcome>;

export type ScenarioMap = Partial<Record<CriterionId, ScenarioHandler>>;

export function makeIdleState(): CriterionState {
  return { status: 'idle', details: '' };
}
