// Plugin runner — paired bridge + runtime mock factory for tests.
//
// Real Web Workers do not run in jsdom, so unit + integration tests pair a
// `PluginAPIBridge` with an in-process `PluginRuntime` over in-memory message
// queues. This helper:
//
//   1. Exports `makePairedBridge(manifest, hooks, options)` which returns the
//      bridge already wired to a runtime. The runtime imports plugin source
//      via an in-process loader the test supplies (no Blob URL machinery).
//   2. Exports `inlinePluginLoader(modules)` for the common case where the
//      test wants to map plugin code strings to TS fixture modules.
//
// The bridge + runtime + protocol code paths are all REAL; only the Worker
// shell is mocked. This matches the spike's discipline so test signal stays
// honest.
//
// Plan: docs/superpowers/plans/2026-05-03-stream-c3-plugin-runner.md (task 2.7)

import {
  PluginAPIBridge,
  type PluginBridgeHooks,
  type PluginWorkerLike,
} from '@/modules/plugins/PluginAPIBridge';
import {
  PluginRuntime,
  type PluginLoader,
  type PluginWorkerScope,
} from '@/modules/plugins/PluginRuntime';
import type { PluginManifest, PluginModule } from '@/types/plugin';

/**
 * Result of `makePairedBridge`: the bridge, plus the runtime instance for
 * tests that want to drive it directly (rare; most tests should use the
 * bridge surface).
 */
export interface PairedBridge {
  bridge: PluginAPIBridge;
  runtime: PluginRuntime;
}

export interface PairedBridgeOptions {
  /** Required: maps plugin source strings to PluginModule instances. */
  loader: PluginLoader;
}

/**
 * Build a bridge whose worker is a paired in-process runtime. Messages cross
 * via `queueMicrotask`-deferred dispatch so the bridge finishes synchronous
 * bookkeeping before the runtime sees a posted message (matches real Worker
 * semantics).
 */
export function makePairedBridge(
  manifest: PluginManifest,
  hooks: PluginBridgeHooks,
  options: PairedBridgeOptions,
): PairedBridge {
  const bridgeListeners = new Set<(event: { data?: unknown }) => void>();
  const runtimeListeners = new Set<(event: { data?: unknown }) => void>();

  const workerLike: PluginWorkerLike = {
    postMessage(data) {
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

  const scope: PluginWorkerScope = {
    postMessage(data) {
      queueMicrotask(() => {
        for (const l of bridgeListeners) l({ data });
      });
    },
    addEventListener(_type, listener) {
      runtimeListeners.add(listener);
    },
  };

  const runtime = new PluginRuntime({ scope, loader: options.loader });
  const bridge = new PluginAPIBridge(manifest, hooks, () => workerLike);
  return { bridge, runtime };
}

/**
 * Build a `PluginLoader` from a static map of plugin source string ->
 * PluginModule. Useful when a test wants to pre-register two or three known
 * plugin sources (e.g. one happy-path plugin + one that throws).
 */
export function inlinePluginLoader(modules: Record<string, PluginModule>): PluginLoader {
  return async (code) => {
    const mod = modules[code];
    if (!mod) {
      throw new Error(`pluginMockFactory.inlinePluginLoader: no module registered for source key`);
    }
    return mod;
  };
}

/**
 * Convenience: make a minimal valid `PluginManifest` for tests that don't
 * care about the field values. Caller can override any fields via overrides.
 */
export function fakeManifest(overrides: Partial<PluginManifest> = {}): PluginManifest {
  return {
    id: overrides.id ?? 'test-plugin',
    name: overrides.name ?? 'Test Plugin',
    version: overrides.version ?? '1.0.0',
    apiVersion: overrides.apiVersion ?? '2.0.0',
    author: overrides.author ?? { name: 'Test Author' },
    description: overrides.description ?? 'A test plugin.',
    main: overrides.main ?? 'index.js',
    permissions: overrides.permissions ?? [],
    minKeepanceVersion: overrides.minKeepanceVersion ?? '2.0.0',
    category: overrides.category ?? 'utility',
    tags: overrides.tags ?? [],
    ...(overrides.maxKeepanceVersion !== undefined ? { maxKeepanceVersion: overrides.maxKeepanceVersion } : {}),
    ...(overrides.screenshots !== undefined ? { screenshots: overrides.screenshots } : {}),
    ...(overrides.homepage !== undefined ? { homepage: overrides.homepage } : {}),
    ...(overrides.license !== undefined ? { license: overrides.license } : {}),
  };
}
