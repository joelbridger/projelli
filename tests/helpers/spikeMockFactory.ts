// Plugin Spike — shared test helper.
//
// Real Web Workers do not run in jsdom, so the spike's unit and integration
// tests share a paired SpikeAPIBridge + SpikePluginRuntime where messages
// cross via in-memory queues. This helper exports:
//
//   1. `permittedFixture()` / `deniedFixture()` — TS mirrors of the JS plugin
//      sources. Functionally identical to the strings in
//      `spike-plugin-permitted.ts` / `spike-plugin-denied.ts` so scenario
//      assertions match what the real plugin produces in the live harness.
//   2. `makePairedBridgeFactory()` — returns a `BridgeFactory` that wires a
//      mock SpikeWorkerLike to an in-process SpikePluginRuntime. The runtime
//      uses a loader that maps the two known plugin source strings to the
//      fixture mirrors above.
//
// Both `tests/unit/pluginSpike/scenarios.test.ts` and
// `tests/integration/pluginSpike/all-criteria.test.ts` consume this helper so
// the criterion logic is asserted against a single canonical mock pipeline.
//
// Spec: docs/superpowers/specs/2026-04-28-v2.0-mega-release-design.md §6.3
// Plan: docs/superpowers/plans/2026-05-03-stream-c2-plugin-spike.md

import { SpikeAPIBridge, type SpikeWorkerLike } from '@/modules/pluginSpike/SpikeAPIBridge';
import {
  SpikePluginRuntime,
  type SpikePluginLoader,
  type SpikePluginModule,
  type SpikeWorkerScope,
} from '@/modules/pluginSpike/SpikePluginRuntime';
import type { BridgeFactory } from '@/modules/pluginSpike/scenarios';
import { SPIKE_PERMITTED_PLUGIN_CODE } from '@/modules/pluginSpike/spike-plugin-permitted';
import { SPIKE_DENIED_PLUGIN_CODE } from '@/modules/pluginSpike/spike-plugin-denied';
import type { SpikeAPI, SpikePermission } from '@/types/pluginSpike';

/**
 * Permitted-plugin fixture: TS mirror of `spike-plugin-permitted.ts`. Kept
 * functionally identical to the JS source so the scenarios assertion path
 * matches what the real plugin produces in the live harness.
 *
 * Worker-isolation values for criterion-1 are hard-coded as `'undefined'`
 * because in jsdom both `document` and `window` are defined. The integration
 * test acknowledges this divergence; the real-Worker smoke test in the live
 * app validates the actual isolation guarantee.
 */
export function permittedFixture(): SpikePluginModule {
  return {
    activate: async (api: SpikeAPI, ctx: { permissions: SpikePermission[] }) => {
      api.commands.register('criterion-1', () => ({
        documentType: 'undefined' as const,
        windowType: 'undefined' as const,
        hasSelf: true,
        permissions: ctx.permissions,
      }));
      api.commands.register('criterion-2', (payload) => {
        const echo =
          payload && typeof payload === 'object' && 'echo' in (payload as Record<string, unknown>)
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
        const mode =
          payload && typeof payload === 'object' && 'mode' in (payload as Record<string, unknown>)
            ? String((payload as { mode: unknown }).mode)
            : 'sync';
        if (mode === 'async') return Promise.reject(new Error('async plugin crash'));
        throw new Error('sync plugin crash');
      });
      api.commands.register('criterion-8', () => 'ok');
    },
  };
}

/**
 * Denied-plugin fixture: TS mirror of `spike-plugin-denied.ts`. Registers
 * only `criterion-6` to exercise permission denial when `editor:selection`
 * is absent from the manifest.
 */
export function deniedFixture(): SpikePluginModule {
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
 *
 * Each call returns a fresh factory closure; bridges built by it are fully
 * independent so tests can run in any order without shared state.
 */
export function makePairedBridgeFactory(): BridgeFactory {
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
