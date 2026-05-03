// Plugin Spike - per-criterion scenario handlers.
//
// Each handler owns a fresh `SpikeAPIBridge` lifecycle (construct, sendInit,
// invokeCommand, terminate) and reports back a structured `ScenarioOutcome`
// the harness UI displays. Bridge construction is injected via `makeBridge`
// so tests can swap in a mock-worker factory without rewriting scenario
// logic. In the running app the page passes a real-Worker-backed factory.
//
// Plugin source code is authored as a JavaScript template literal in
// `spike-plugin-permitted.ts` / `spike-plugin-denied.ts`. The runtime turns
// the string into a Blob URL and dynamic-imports it.
//
// Spec: docs/superpowers/specs/2026-04-28-v2.0-mega-release-design.md §6.3
// Plan: docs/superpowers/plans/2026-05-03-stream-c2-plugin-spike.md

import type {
  SpikeBridgeManifest,
  SpikeAPIBridge,
} from './SpikeAPIBridge';
import { SPIKE_DENIED_PLUGIN_CODE } from './spike-plugin-denied';
import { SPIKE_PERMITTED_PLUGIN_CODE } from './spike-plugin-permitted';

import type { CriterionId, ScenarioMap, ScenarioOutcome } from '@/components/pluginSpike/types';
import type { SpikeError } from '@/types/pluginSpike';

/**
 * Factory used to construct bridges. Production passes a closure that wires
 * up a real Vite-built Worker; tests pass one that pairs a SpikeWorkerLike
 * mock with an in-process SpikePluginRuntime so jsdom can run the full
 * pipeline. The factory MUST honor `hooks.onRegisterCommand` so scenarios
 * can wait for the plugin to finish registering before invoking commands.
 */
export type BridgeFactory = (
  manifest: SpikeBridgeManifest,
  hooks: { onRegisterCommand: (commandId: string) => void },
) => SpikeAPIBridge;

export interface BuildScenariosOptions {
  /**
   * Bridge factory. Production passes a closure that constructs a real
   * `SpikeAPIBridge` over a Vite-built worker; tests pass a closure that pairs
   * a mock SpikeWorkerLike with an in-process SpikePluginRuntime so the
   * full message pipeline runs without a real Worker.
   *
   * Required. There is no sensible default because constructing a real Worker
   * needs Vite's `?worker` import, which only resolves in the live bundle.
   */
  makeBridge: BridgeFactory;
  /**
   * Override timeout for waiting on a plugin to register a command. Defaults
   * to 1500ms which is generous for the spike's tiny plugin sources.
   */
  registerTimeoutMs?: number;
}

const DEFAULT_REGISTER_TIMEOUT_MS = 1500;

/**
 * Wait for a specific command to be registered by the worker. Resolves once
 * the bridge surfaces an `onRegisterCommand` callback for the id, or when a
 * subsequent `getRegisteredCommands()` poll returns it (covers the race where
 * registration arrived before this helper attached). Rejects on timeout.
 */
function makeBridgeWithReadiness(
  factory: BridgeFactory,
  manifest: SpikeBridgeManifest,
  expectedCommandId: string,
  timeoutMs: number,
): { bridge: SpikeAPIBridge; ready: Promise<void> } {
  let resolveReady!: () => void;
  let rejectReady!: (err: Error) => void;
  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });

  const bridge = factory(manifest, {
    onRegisterCommand: (commandId: string) => {
      if (commandId === expectedCommandId) resolveReady();
    },
  });

  // Defensive poll for the case where registration was synchronous (mock
  // bridges may emit register-command before the activate() microtask yields).
  if (bridge.getRegisteredCommands().includes(expectedCommandId)) {
    resolveReady();
  }

  const timer = setTimeout(() => {
    rejectReady(new Error(`timed out waiting for command ${expectedCommandId} to register`));
  }, timeoutMs);
  void ready.finally(() => {
    clearTimeout(timer);
  });

  return { bridge, ready };
}

function errorToCode(err: unknown): string {
  const e = err as { code?: string } | undefined;
  return e?.code ?? 'no-code';
}

/**
 * Compute median, p95, max from a numeric array. Caller is responsible for
 * trimming warmup samples first. Returns 0 for all stats on an empty input.
 */
export function computeLatencyStats(samples: number[]): {
  medianMs: number;
  p95Ms: number;
  maxMs: number;
  count: number;
} {
  if (samples.length === 0) return { medianMs: 0, p95Ms: 0, maxMs: 0, count: 0 };
  const sorted = [...samples].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
  const p95Index = Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95));
  const p95 = sorted[p95Index] ?? 0;
  const max = sorted[sorted.length - 1] ?? 0;
  return { medianMs: median, p95Ms: p95, maxMs: max, count: samples.length };
}

/**
 * Construct the per-criterion scenario map. Caller MUST supply `makeBridge`
 * because constructing a real Worker requires Vite's `?worker` import, which
 * lives at the call site (PluginSpikePage in production, mock-worker pair in
 * tests).
 */
export function buildScenarios(options: BuildScenariosOptions): ScenarioMap {
  const factory: BridgeFactory = options.makeBridge;
  const registerTimeoutMs = options.registerTimeoutMs ?? DEFAULT_REGISTER_TIMEOUT_MS;

  const map: Record<CriterionId, () => Promise<ScenarioOutcome>> = {
    1: () => criterion1(factory, registerTimeoutMs),
    2: () => criterion2(factory, registerTimeoutMs),
    3: () => criterion3(factory, registerTimeoutMs),
    4: () => criterion4(factory, registerTimeoutMs),
    5: () => criterion5(factory, registerTimeoutMs),
    6: () => criterion6(factory, registerTimeoutMs),
    7: () => criterion7(factory, registerTimeoutMs),
    8: () => criterion8(factory, registerTimeoutMs),
  };
  return map;
}

// ----- Criterion handlers ----------------------------------------------------

async function criterion1(factory: BridgeFactory, timeoutMs: number): Promise<ScenarioOutcome> {
  const { bridge, ready } = makeBridgeWithReadiness(
    factory,
    { permissions: ['editor:selection'] },
    'criterion-1',
    timeoutMs,
  );
  try {
    bridge.sendInit({ code: SPIKE_PERMITTED_PLUGIN_CODE });
    await ready;
    const result = (await bridge.invokeCommand('criterion-1')) as {
      documentType: string;
      windowType: string;
      hasSelf: boolean;
    };
    const isolated =
      result.documentType === 'undefined' &&
      result.windowType === 'undefined' &&
      result.hasSelf;
    if (!isolated) {
      return {
        status: 'fail',
        details: `worker not isolated: document=${result.documentType}, window=${result.windowType}`,
      };
    }
    return {
      status: 'pass',
      details: 'document/window are undefined inside the worker; self is defined.',
    };
  } finally {
    bridge.terminate();
  }
}

async function criterion2(factory: BridgeFactory, timeoutMs: number): Promise<ScenarioOutcome> {
  const { bridge, ready } = makeBridgeWithReadiness(
    factory,
    { permissions: [] },
    'criterion-2',
    timeoutMs,
  );
  try {
    bridge.sendInit({ code: SPIKE_PERMITTED_PLUGIN_CODE });
    await ready;
    const stringResult = (await bridge.invokeCommand('criterion-2', { echo: 'pong' })) as string;
    const voidResult = await bridge.invokeCommand('criterion-2');
    if (stringResult !== 'pong') {
      return { status: 'fail', details: `expected 'pong', got ${JSON.stringify(stringResult)}` };
    }
    if (voidResult !== 'pong') {
      return { status: 'fail', details: `default echo mismatch: ${JSON.stringify(voidResult)}` };
    }
    return {
      status: 'pass',
      details: 'round-trip succeeded for both string-payload and default-payload returns.',
    };
  } finally {
    bridge.terminate();
  }
}

async function criterion3(factory: BridgeFactory, timeoutMs: number): Promise<ScenarioOutcome> {
  const { bridge, ready } = makeBridgeWithReadiness(
    factory,
    { permissions: ['editor:selection'] },
    'criterion-3',
    timeoutMs,
  );
  try {
    bridge.sendInit({ code: SPIKE_PERMITTED_PLUGIN_CODE });
    await ready;
    const result = (await bridge.invokeCommand('criterion-3')) as {
      rejected: boolean;
      code?: string;
      message?: string;
    };
    if (!result.rejected) {
      return { status: 'fail', details: 'workspace.readFile did not reject; sandbox leaked.' };
    }
    if (result.code !== 'permission-denied') {
      return {
        status: 'fail',
        details: `unexpected error code: ${String(result.code)} (expected permission-denied)`,
      };
    }
    return {
      status: 'pass',
      details: `workspace.readFile rejected with permission-denied: "${result.message ?? ''}".`,
    };
  } finally {
    bridge.terminate();
  }
}

async function criterion4(factory: BridgeFactory, timeoutMs: number): Promise<ScenarioOutcome> {
  const { bridge, ready } = makeBridgeWithReadiness(
    factory,
    { permissions: ['editor:selection'] },
    'criterion-4',
    timeoutMs,
  );
  let capturedSpec: ScenarioOutcome['sidebarSpec'];
  const unsubscribe = bridge.onPanelRender((event) => {
    capturedSpec = event.spec;
  });
  try {
    bridge.sendInit({ code: SPIKE_PERMITTED_PLUGIN_CODE });
    await ready;
    const result = (await bridge.invokeCommand('criterion-4')) as { rendered: boolean };
    if (!result.rendered) {
      return { status: 'fail', details: 'plugin did not report a render attempt.' };
    }
    if (!capturedSpec) {
      return {
        status: 'fail',
        details: 'no panel-render event observed by main-thread listener.',
      };
    }
    return {
      status: 'pass',
      details: `panel-render observed: id=${capturedSpec.id}, title="${capturedSpec.title}".`,
      sidebarSpec: capturedSpec,
    };
  } finally {
    unsubscribe();
    bridge.terminate();
  }
}

async function criterion5(factory: BridgeFactory, timeoutMs: number): Promise<ScenarioOutcome> {
  // First load.
  const first = makeBridgeWithReadiness(
    factory,
    { permissions: ['editor:selection'] },
    'criterion-5',
    timeoutMs,
  );
  try {
    first.bridge.sendInit({ code: SPIKE_PERMITTED_PLUGIN_CODE });
    await first.ready;
    const r1 = (await first.bridge.invokeCommand('criterion-5')) as { activated: boolean };
    if (!r1.activated) {
      return { status: 'fail', details: 'first load: plugin did not activate.' };
    }
  } finally {
    first.bridge.terminate();
  }
  if (!first.bridge.isTerminated()) {
    return { status: 'fail', details: 'first bridge did not report terminated.' };
  }

  // Reload - fresh bridge with same code.
  const second = makeBridgeWithReadiness(
    factory,
    { permissions: ['editor:selection'] },
    'criterion-5',
    timeoutMs,
  );
  try {
    second.bridge.sendInit({ code: SPIKE_PERMITTED_PLUGIN_CODE });
    await second.ready;
    const r2 = (await second.bridge.invokeCommand('criterion-5')) as { activated: boolean };
    if (!r2.activated) {
      return { status: 'fail', details: 'reload: plugin did not re-activate.' };
    }
  } finally {
    second.bridge.terminate();
  }

  // Unload assertion - invoking after terminate must throw, not hang.
  let threwAfterUnload = false;
  try {
    void second.bridge.invokeCommand('criterion-5');
  } catch {
    threwAfterUnload = true;
  }
  if (!threwAfterUnload) {
    return { status: 'fail', details: 'unload: invokeCommand did not throw on terminated bridge.' };
  }

  return {
    status: 'pass',
    details: 'load + reload + unload completed; bridges terminated cleanly between cycles.',
  };
}

async function criterion6(factory: BridgeFactory, timeoutMs: number): Promise<ScenarioOutcome> {
  const permitted = makeBridgeWithReadiness(
    factory,
    { permissions: ['editor:selection'] },
    'criterion-6',
    timeoutMs,
  );
  const denied = makeBridgeWithReadiness(
    factory,
    { permissions: [] },
    'criterion-6',
    timeoutMs,
  );
  try {
    permitted.bridge.sendInit({ code: SPIKE_PERMITTED_PLUGIN_CODE });
    denied.bridge.sendInit({ code: SPIKE_DENIED_PLUGIN_CODE });
    await Promise.all([permitted.ready, denied.ready]);

    const permittedResult = (await permitted.bridge.invokeCommand('criterion-6')) as {
      ok: boolean;
      selection?: string;
      code?: string;
    };
    const deniedResult = (await denied.bridge.invokeCommand('criterion-6')) as {
      ok: boolean;
      code?: string;
    };

    if (!permittedResult.ok) {
      return {
        status: 'fail',
        details: `permitted plugin failed unexpectedly: code=${String(permittedResult.code)}.`,
      };
    }
    if (deniedResult.ok) {
      return {
        status: 'fail',
        details: 'denied plugin succeeded: permission enforcement leaked.',
      };
    }
    if (deniedResult.code !== 'permission-denied') {
      return {
        status: 'fail',
        details: `denied plugin rejected with unexpected code: ${String(deniedResult.code)}.`,
      };
    }
    return {
      status: 'pass',
      details: `permitted plugin returned "${permittedResult.selection ?? ''}"; denied plugin got permission-denied.`,
    };
  } finally {
    permitted.bridge.terminate();
    denied.bridge.terminate();
  }
}

async function criterion7(factory: BridgeFactory, timeoutMs: number): Promise<ScenarioOutcome> {
  const { bridge, ready } = makeBridgeWithReadiness(
    factory,
    { permissions: ['editor:selection'] },
    'criterion-7',
    timeoutMs,
  );

  // Heartbeat. setInterval fires on the main thread; if the worker takes the
  // process down, this stops ticking. We want it to keep ticking through the
  // throw so we can prove crash isolation.
  let heartbeatCount = 0;
  const interval = setInterval(() => {
    heartbeatCount += 1;
  }, 16);
  const heartbeatStart = performance.now();

  let syncCode = '';
  let asyncCode = '';

  try {
    bridge.sendInit({ code: SPIKE_PERMITTED_PLUGIN_CODE });
    await ready;

    // Synchronous throw.
    try {
      await bridge.invokeCommand('criterion-7', { mode: 'sync' });
      return { status: 'fail', details: 'sync invocation did not reject.' };
    } catch (err) {
      syncCode = errorToCode(err);
    }

    // Async / Promise rejection. Recreate bridge if the previous error event
    // killed pending tracking; in this case the bridge state is fine because
    // the error was per-call, not worker-global.
    try {
      await bridge.invokeCommand('criterion-7', { mode: 'async' });
      return { status: 'fail', details: 'async invocation did not reject.' };
    } catch (err) {
      asyncCode = errorToCode(err);
    }

    // Hold heartbeat for ~1 second total so the assertion has a meaningful
    // sample size. Bound the wait via performance.now to avoid hangs.
    const targetEnd = heartbeatStart + 1000;
    while (performance.now() < targetEnd) {
      await new Promise<void>((r) => setTimeout(r, 16));
    }
  } finally {
    clearInterval(interval);
    bridge.terminate();
  }

  if (heartbeatCount < 5) {
    return {
      status: 'fail',
      details: `heartbeat only ticked ${String(heartbeatCount)} times during the throw window.`,
    };
  }
  if (syncCode !== 'plugin-threw' || asyncCode !== 'plugin-threw') {
    return {
      status: 'fail',
      details: `unexpected error codes: sync=${syncCode}, async=${asyncCode}.`,
    };
  }
  return {
    status: 'pass',
    details: `heartbeat ticked ${String(heartbeatCount)}x through sync + async plugin throws.`,
    metrics: { heartbeatTicks: heartbeatCount },
  };
}

async function criterion8(factory: BridgeFactory, timeoutMs: number): Promise<ScenarioOutcome> {
  const { bridge, ready } = makeBridgeWithReadiness(
    factory,
    { permissions: ['editor:selection'] },
    'criterion-8',
    timeoutMs,
  );
  const TOTAL_RUNS = 100;
  const WARMUP = 5;
  const timings: number[] = [];
  try {
    bridge.sendInit({ code: SPIKE_PERMITTED_PLUGIN_CODE });
    await ready;
    for (let i = 0; i < TOTAL_RUNS; i += 1) {
      const start = performance.now();
      await bridge.invokeCommand('criterion-8');
      const end = performance.now();
      timings.push(end - start);
    }
  } finally {
    bridge.terminate();
  }
  const measured = timings.slice(WARMUP);
  const stats = computeLatencyStats(measured);
  // The pass threshold is informational here - the harness reports actual
  // numbers and the memo decides go/no-go. We mark fail only on obvious
  // pathology (median > 200ms in any environment).
  const PATHOLOGICAL_MEDIAN_MS = 200;
  const status: ScenarioOutcome['status'] = stats.medianMs > PATHOLOGICAL_MEDIAN_MS ? 'fail' : 'pass';
  return {
    status,
    details: `${String(measured.length)} measured round-trips: median ${stats.medianMs.toFixed(2)}ms, p95 ${stats.p95Ms.toFixed(2)}ms, max ${stats.maxMs.toFixed(2)}ms.`,
    metrics: {
      medianMs: stats.medianMs,
      p95Ms: stats.p95Ms,
      maxMs: stats.maxMs,
      count: stats.count,
    },
    timings: measured,
  };
}

// Re-export for callers that want to fabricate a quick error shape.
export type { SpikeError };
