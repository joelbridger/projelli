// Plugin Spike - scenarios tests.
//
// Real Web Workers are not available in jsdom. Instead, each scenario is
// driven against a paired SpikeAPIBridge + SpikePluginRuntime where the
// "worker" is a thin in-memory channel that pipes messages between the two
// halves. Rather than evaluate the plugin source strings (which would need
// a code-eval primitive in the test environment), the tests inject a
// SpikePluginLoader that returns a TS fixture module mirroring the same
// logic. The plugin source strings themselves are validated separately by
// runtime/bridge integration tests and by Group V's end-to-end spec.
//
// Spec: docs/superpowers/specs/2026-04-28-v2.0-mega-release-design.md §6.3
// Plan: docs/superpowers/plans/2026-05-03-stream-c2-plugin-spike.md

import { describe, expect, it } from 'vitest';

import { SpikeAPIBridge, type SpikeWorkerLike } from '@/modules/pluginSpike/SpikeAPIBridge';
import {
  SpikePluginRuntime,
  type SpikePluginLoader,
  type SpikePluginModule,
  type SpikeWorkerScope,
} from '@/modules/pluginSpike/SpikePluginRuntime';
import {
  buildScenarios,
  computeLatencyStats,
  type BridgeFactory,
} from '@/modules/pluginSpike/scenarios';
import { SPIKE_PERMITTED_PLUGIN_CODE } from '@/modules/pluginSpike/spike-plugin-permitted';
import { SPIKE_DENIED_PLUGIN_CODE } from '@/modules/pluginSpike/spike-plugin-denied';
import type { SpikeAPI, SpikePermission } from '@/types/pluginSpike';

/**
 * Permitted-plugin fixture: TS mirror of `spike-plugin-permitted.ts`. Kept
 * functionally identical to the JS string so scenario assertions match what
 * the real plugin produces in the live harness.
 */
function permittedFixture(): SpikePluginModule {
  return {
    activate: async (api: SpikeAPI, ctx: { permissions: SpikePermission[] }) => {
      // In jsdom `document` and `window` are defined, but in a real worker
      // they are undefined. The fixture reports the worker-truthful values so
      // the scenario assertion exercises its pass-path. Group V's e2e test
      // (real Worker) validates the actual isolation guarantee.
      api.commands.register('criterion-1', () => ({
        documentType: 'undefined' as const,
        windowType: 'undefined' as const,
        hasSelf: true,
        permissions: ctx.permissions,
      }));
      api.commands.register('criterion-2', (payload) => {
        const echo = payload && typeof payload === 'object' && 'echo' in (payload as Record<string, unknown>)
          ? String((payload as { echo: unknown }).echo)
          : 'pong';
        return echo;
      });
      api.commands.register('criterion-3', async () => {
        try {
          await api.workspace.readFile('/etc/passwd');
          return { rejected: false };
        } catch (err) {
          const e = err as { code?: string; message?: string };
          return { rejected: true, code: e.code ?? 'no-code', message: e.message ?? '' };
        }
      });
      api.commands.register('criterion-4', async () => {
        await api.sidebar.addPanel({
          id: 'spike-panel',
          title: 'Spike Panel',
          html: '<p>hello from the plugin sandbox</p>',
        });
        return { rendered: true };
      });
      api.commands.register('criterion-5', () => ({ activated: true }));
      api.commands.register('criterion-6', async () => {
        try {
          const sel = await api.editor.getSelection();
          return { ok: true, selection: sel };
        } catch (err) {
          const e = err as { code?: string; message?: string };
          return { ok: false, code: e.code ?? 'no-code', message: e.message ?? '' };
        }
      });
      api.commands.register('criterion-7', (payload) => {
        const mode = payload && typeof payload === 'object' && 'mode' in (payload as Record<string, unknown>)
          ? String((payload as { mode: unknown }).mode)
          : 'sync';
        if (mode === 'async') return Promise.reject(new Error('async plugin crash'));
        throw new Error('sync plugin crash');
      });
      api.commands.register('criterion-8', () => 'ok');
    },
  };
}

function deniedFixture(): SpikePluginModule {
  return {
    activate: async (api: SpikeAPI, ctx: { permissions: SpikePermission[] }) => {
      api.commands.register('criterion-6', async () => {
        try {
          const sel = await api.editor.getSelection();
          return { ok: true, selection: sel, permissions: ctx.permissions };
        } catch (err) {
          const e = err as { code?: string; message?: string };
          return {
            ok: false,
            code: e.code ?? 'no-code',
            message: e.message ?? '',
            permissions: ctx.permissions,
          };
        }
      });
    },
  };
}

/**
 * Build a paired bridge + runtime where messages cross via in-memory queues.
 * Returns the BridgeFactory `buildScenarios` will consume. The loader maps
 * the two known plugin source strings to their TS fixture mirrors.
 */
function makePairedBridgeFactory(): BridgeFactory {
  const loader: SpikePluginLoader = async (code) => {
    if (code === SPIKE_PERMITTED_PLUGIN_CODE) return permittedFixture();
    if (code === SPIKE_DENIED_PLUGIN_CODE) return deniedFixture();
    throw new Error('unknown plugin source for test fixture');
  };

  return (manifest, hooks) => {
    const bridgeListeners = new Set<(event: { data?: unknown }) => void>();
    const runtimeListeners = new Set<(event: { data?: unknown }) => void>();

    const workerLike: SpikeWorkerLike = {
      postMessage(data) {
        // Defer via microtask so the bridge finishes synchronous bookkeeping
        // before the runtime sees the message. Matches real Worker semantics.
        queueMicrotask(() => {
          for (const l of runtimeListeners) l({ data });
        });
      },
      terminate() {
        bridgeListeners.clear();
        runtimeListeners.clear();
      },
      addEventListener(type, listener) {
        if (type === 'message') {
          bridgeListeners.add(listener as (event: { data?: unknown }) => void);
        }
      },
      removeEventListener(type, listener) {
        if (type === 'message') {
          bridgeListeners.delete(listener as (event: { data?: unknown }) => void);
        }
      },
    };

    const scope: SpikeWorkerScope = {
      postMessage(data) {
        queueMicrotask(() => {
          for (const l of bridgeListeners) l({ data });
        });
      },
      addEventListener(_type, listener) {
        runtimeListeners.add(listener);
      },
    };

    new SpikePluginRuntime({ scope, loader });

    return new SpikeAPIBridge({
      manifest,
      workerFactory: () => workerLike,
      onRegisterCommand: hooks.onRegisterCommand,
    });
  };
}

describe('buildScenarios', () => {
  it('returns one handler per criterion id (1..8)', () => {
    const map = buildScenarios({ makeBridge: makePairedBridgeFactory() });
    const ids = Object.keys(map).map(Number).sort((a, b) => a - b);
    expect(ids).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    for (const id of [1, 2, 3, 4, 5, 6, 7, 8] as const) {
      expect(typeof map[id]).toBe('function');
    }
  });
});

describe('scenario handlers (paired bridge + runtime)', () => {
  it('criterion-1 reports worker isolation as pass', async () => {
    const map = buildScenarios({ makeBridge: makePairedBridgeFactory() });
    const outcome = await map[1]!();
    expect(outcome.status).toBe('pass');
    expect(outcome.details).toContain('document/window are undefined');
  });

  it('criterion-2 round-trips both string and default returns', async () => {
    const map = buildScenarios({ makeBridge: makePairedBridgeFactory() });
    const outcome = await map[2]!();
    expect(outcome.status).toBe('pass');
    expect(outcome.details).toContain('round-trip');
  });

  it('criterion-3 reports permission-denied for workspace.readFile', async () => {
    const map = buildScenarios({ makeBridge: makePairedBridgeFactory() });
    const outcome = await map[3]!();
    expect(outcome.status).toBe('pass');
    expect(outcome.details).toContain('permission-denied');
  });

  it('criterion-4 captures a panel-render event into sidebarSpec', async () => {
    const map = buildScenarios({ makeBridge: makePairedBridgeFactory() });
    const outcome = await map[4]!();
    expect(outcome.status).toBe('pass');
    expect(outcome.sidebarSpec).toBeDefined();
    expect(outcome.sidebarSpec?.id).toBe('spike-panel');
    expect(outcome.sidebarSpec?.html).toContain('hello from the plugin sandbox');
  });

  it('criterion-5 completes a load + reload + unload cycle', async () => {
    const map = buildScenarios({ makeBridge: makePairedBridgeFactory() });
    const outcome = await map[5]!();
    expect(outcome.status).toBe('pass');
    expect(outcome.details).toContain('load + reload + unload');
  });

  it('criterion-6 succeeds for permitted, fails for denied', async () => {
    const map = buildScenarios({ makeBridge: makePairedBridgeFactory() });
    const outcome = await map[6]!();
    expect(outcome.status).toBe('pass');
    expect(outcome.details).toContain('permission-denied');
  });

  it('criterion-7 catches sync + async throws and reports heartbeat ticks', async () => {
    const map = buildScenarios({ makeBridge: makePairedBridgeFactory() });
    const outcome = await map[7]!();
    expect(outcome.status).toBe('pass');
    expect(outcome.metrics?.heartbeatTicks).toBeGreaterThanOrEqual(5);
  }, 5000);

  it('criterion-8 produces 95 measured timings (after 5 warmup discards)', async () => {
    const map = buildScenarios({ makeBridge: makePairedBridgeFactory() });
    const outcome = await map[8]!();
    expect(outcome.status).toBe('pass');
    expect(outcome.timings).toHaveLength(95);
    expect(outcome.metrics?.count).toBe(95);
    expect(outcome.metrics?.medianMs).toBeGreaterThanOrEqual(0);
  }, 10000);
});

describe('computeLatencyStats', () => {
  it('returns zeros for empty input', () => {
    expect(computeLatencyStats([])).toEqual({ medianMs: 0, p95Ms: 0, maxMs: 0, count: 0 });
  });

  it('computes median, p95, max from an unsorted input', () => {
    const samples = [5, 1, 3, 2, 4, 100];
    const stats = computeLatencyStats(samples);
    expect(stats.count).toBe(6);
    expect(stats.maxMs).toBe(100);
    // sorted: 1,2,3,4,5,100; median index = floor(6/2) = 3 → 4
    expect(stats.medianMs).toBe(4);
    // p95 index = floor(6 * 0.95) = 5 → 100
    expect(stats.p95Ms).toBe(100);
  });
});

describe('plugin source self-test', () => {
  // Cheap, no-eval validation that the source strings export `activate` and
  // contain the 8 criterion command registrations. If the source ever drifts
  // (typo, missing command), this fails fast.
  it('permitted plugin source contains all 8 criterion registrations', () => {
    expect(SPIKE_PERMITTED_PLUGIN_CODE).toContain('export async function activate');
    for (let i = 1; i <= 8; i += 1) {
      expect(SPIKE_PERMITTED_PLUGIN_CODE).toContain(`'criterion-${i}'`);
    }
  });

  it('denied plugin source declares only criterion-6 and exports activate', () => {
    expect(SPIKE_DENIED_PLUGIN_CODE).toContain('export async function activate');
    expect(SPIKE_DENIED_PLUGIN_CODE).toContain("'criterion-6'");
    // No other criterion commands registered.
    for (const i of [1, 2, 3, 4, 5, 7, 8]) {
      expect(SPIKE_DENIED_PLUGIN_CODE).not.toContain(`'criterion-${i}'`);
    }
  });
});
