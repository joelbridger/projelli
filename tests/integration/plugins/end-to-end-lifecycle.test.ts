// End-to-end integration test for the Stream C3 sandboxed plugin runner.
//
// Drives the real `PluginManager` + `PluginWorkerHost` + `PluginAPIBridge` +
// `PluginRuntime` against the on-disk word-counter and crashing-plugin
// fixtures. The Worker shell is the only thing replaced with a paired
// in-process runtime (real Web Workers do not run in jsdom). Tauri commands
// (`extract_tarball`, `sha256_file`) are stubbed via `vi.mock`. The FSBackend
// is an in-memory map seeded directly with the fixture files; we skip the
// install-from-tarball flow because the C4 marketplace plan covers it
// end-to-end.
//
// Plan: docs/superpowers/plans/2026-05-03-stream-c3-plugin-runner.md (task 9.2)

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

import {
  PluginAPIBridge,
  type PluginBridgeHooks,
  type PluginWorkerFactory,
  type PluginWorkerLike,
} from '@/modules/plugins/PluginAPIBridge';
import { PluginManager } from '@/modules/plugins/PluginManager';
import {
  setActivePluginManager,
  getActivePluginManager,
} from '@/modules/plugins/pluginManagerHolder';
import {
  PluginRuntime,
  type PluginLoader,
  type PluginWorkerScope,
} from '@/modules/plugins/PluginRuntime';
import { AuditService } from '@/modules/audit/AuditService';
import {
  selectStatus,
  usePluginManagerStore,
} from '@/stores/pluginManagerStore';
import { usePluginRegistryStore } from '@/stores/pluginRegistryStore';
import type { FSBackend } from '@/modules/workspace/types';
import type { PluginManifest, PluginModule } from '@/types/plugin';

// ---------------------------------------------------------------------------
// Fixture loading
// ---------------------------------------------------------------------------

const FIXTURE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../fixtures/plugins');

interface PluginFixture {
  manifest: PluginManifest;
  source: string;
  module: PluginModule;
}

function loadFixture(slug: string, importedModule: PluginModule): PluginFixture {
  const manifest = JSON.parse(
    readFileSync(`${FIXTURE_DIR}/${slug}/manifest.json`, 'utf-8'),
  ) as PluginManifest;
  const source = readFileSync(`${FIXTURE_DIR}/${slug}/index.js`, 'utf-8');
  return { manifest, source, module: importedModule };
}

// Importing the fixture .js as an ES module sidesteps the blob URL path that
// jsdom does not support. The runtime's loader is replaced below to map the
// raw source string back to this module.
import wordCounterModule from '../../fixtures/plugins/word-counter/index.js';
import crashingPluginModule from '../../fixtures/plugins/crashing-plugin/index.js';

// ---------------------------------------------------------------------------
// In-memory FSBackend with directory awareness
// ---------------------------------------------------------------------------

interface FakeFs {
  fs: FSBackend;
  files: Map<string, string>;
  dirs: Set<string>;
}

function makeFs(): FakeFs {
  const files = new Map<string, string>();
  const binaryFiles = new Map<string, Uint8Array>();
  const dirs = new Set<string>();
  const fs = {
    read: vi.fn(async (p: string) => {
      const v = files.get(p);
      if (v === undefined) throw new Error(`ENOENT: ${p}`);
      return v;
    }),
    write: vi.fn(async (p: string, c: string) => {
      files.set(p, c);
    }),
    readBinary: vi.fn(async (p: string) =>
      (binaryFiles.get(p) ?? new Uint8Array()).buffer,
    ),
    writeBinary: vi.fn(async (p: string, b: ArrayBuffer) => {
      binaryFiles.set(p, new Uint8Array(b));
    }),
    exists: vi.fn(async (p: string) => {
      if (files.has(p) || binaryFiles.has(p) || dirs.has(p)) return true;
      const prefix = `${p}/`;
      for (const k of files.keys()) if (k.startsWith(prefix)) return true;
      for (const k of binaryFiles.keys()) if (k.startsWith(prefix)) return true;
      for (const k of dirs) if (k.startsWith(prefix)) return true;
      return false;
    }),
    delete: vi.fn(async (p: string) => {
      files.delete(p);
      binaryFiles.delete(p);
      dirs.delete(p);
      const prefix = `${p}/`;
      for (const k of [...files.keys()]) if (k.startsWith(prefix)) files.delete(k);
      for (const k of [...binaryFiles.keys()]) if (k.startsWith(prefix)) binaryFiles.delete(k);
      for (const k of [...dirs]) if (k.startsWith(prefix)) dirs.delete(k);
    }),
    move: vi.fn(async (from: string, to: string) => {
      const text = files.get(from);
      const bin = binaryFiles.get(from);
      const wasDir = dirs.has(from);
      if (text !== undefined) {
        files.set(to, text);
        files.delete(from);
      }
      if (bin) {
        binaryFiles.set(to, bin);
        binaryFiles.delete(from);
      }
      if (wasDir) {
        dirs.delete(from);
        dirs.add(to);
      }
      const prefix = `${from}/`;
      for (const k of [...files.keys()]) {
        if (k.startsWith(prefix)) {
          const next = `${to}/${k.slice(prefix.length)}`;
          files.set(next, files.get(k) ?? '');
          files.delete(k);
        }
      }
      for (const k of [...binaryFiles.keys()]) {
        if (k.startsWith(prefix)) {
          const next = `${to}/${k.slice(prefix.length)}`;
          binaryFiles.set(next, binaryFiles.get(k) ?? new Uint8Array());
          binaryFiles.delete(k);
        }
      }
      for (const k of [...dirs]) {
        if (k.startsWith(prefix)) {
          const next = `${to}/${k.slice(prefix.length)}`;
          dirs.add(next);
          dirs.delete(k);
        }
      }
    }),
    copy: vi.fn(),
    rename: vi.fn(),
    mkdir: vi.fn(async (p: string) => {
      dirs.add(p);
    }),
    list: vi.fn(),
    stat: vi.fn(),
    isSymlink: vi.fn(),
    resolveSymlink: vi.fn(),
    getRootPath: vi.fn(() => '/ws'),
    setRootPath: vi.fn(),
  } as unknown as FSBackend;
  return { fs, files, dirs };
}

// ---------------------------------------------------------------------------
// Paired worker factory.
//
// The PluginManager constructs a fresh PluginAPIBridge per plugin via the
// supplied workerFactory. We give it a factory that, on each call, allocates
// a fresh PluginRuntime + a paired worker shell over in-memory message
// queues. The runtime's loader maps source string -> the corresponding
// PluginModule (so we never go through Blob URLs / dynamic import).
// ---------------------------------------------------------------------------

function makePairedWorkerFactory(modules: Record<string, PluginModule>): {
  factory: PluginWorkerFactory;
  runtimes: PluginRuntime[];
} {
  const runtimes: PluginRuntime[] = [];
  const loader: PluginLoader = async (code) => {
    const mod = modules[code];
    if (!mod) {
      throw new Error('paired worker factory: no module registered for plugin source');
    }
    return mod;
  };

  const factory: PluginWorkerFactory = () => {
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

    runtimes.push(new PluginRuntime({ scope, loader }));
    return workerLike;
  };

  return { factory, runtimes };
}

// ---------------------------------------------------------------------------
// Test harness setup
// ---------------------------------------------------------------------------

const APP_VERSION = '2.0.0';
const INSTALL_ROOT = '/ws/.projelli/plugins';

function seedPlugin(fakeFs: FakeFs, fixture: PluginFixture): void {
  fakeFs.files.set(
    `${INSTALL_ROOT}/${fixture.manifest.id}/manifest.json`,
    JSON.stringify(fixture.manifest),
  );
  fakeFs.files.set(
    `${INSTALL_ROOT}/${fixture.manifest.id}/${fixture.manifest.main}`,
    fixture.source,
  );
}

/**
 * Drain pending microtasks until the predicate returns true or `attempts` is
 * exhausted. The paired bridge/runtime defer messages with `queueMicrotask`,
 * so an end-to-end command invocation needs a few "yield to the event loop"
 * iterations before the result lands.
 */
async function waitFor(predicate: () => boolean, attempts = 50): Promise<void> {
  for (let i = 0; i < attempts; i += 1) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 0));
  }
  throw new Error('waitFor: predicate did not become true');
}

beforeEach(() => {
  usePluginManagerStore.setState({
    installedPlugins: [],
    statusByPluginId: {},
    errorsByPluginId: {},
  });
  usePluginRegistryStore.setState({
    commands: new Map(),
    toolbar: [],
    sidebar: [],
    settingsPages: [],
  });
  setActivePluginManager(null);
  if (typeof localStorage !== 'undefined') {
    localStorage.clear();
  }
});

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('Plugin runner end-to-end lifecycle', () => {
  it('enables word-counter, mirrors contributions to the registry, invokes a command, surfaces a crash, restarts, and uninstalls cleanly', async () => {
    const wordCounter = loadFixture('word-counter', wordCounterModule as PluginModule);
    const crashing = loadFixture('crashing-plugin', crashingPluginModule as PluginModule);

    const fakeFs = makeFs();
    seedPlugin(fakeFs, wordCounter);
    seedPlugin(fakeFs, crashing);

    const auditService = new AuditService('plugin-integration');
    const { factory } = makePairedWorkerFactory({
      [wordCounter.source]: wordCounter.module,
      [crashing.source]: crashing.module,
    });

    // The editor accessor is mutated to swap the active document content.
    let activeContent = 'hello world from the plugin runner integration test';
    const manager = new PluginManager({
      fs: fakeFs.fs,
      workspaceService: null,
      installRoot: INSTALL_ROOT,
      appVersion: APP_VERSION,
      workerFactory: factory,
      auditService,
      tauri: {
        extractTarball: vi.fn(async () => []),
        sha256File: vi.fn(async () => 'deadbeef'),
      },
    });
    setActivePluginManager(manager);

    // The integration test exercises the toolbar/palette path, which resolves
    // the singleton via pluginManagerHolder — sanity-check that wiring.
    expect(getActivePluginManager()).toBe(manager);

    manager.setActiveEditor(() => ({
      getContent: () => activeContent,
      getSelection: () => null,
      replaceSelection: () => {
        // no-op for this test
      },
      insertAtCursor: () => {
        // no-op for this test
      },
    }));

    // Pre-populate the in-memory installed list so `enable` finds the plugin
    // record. We skip installFromTarball; the C4 plan covers the marketplace
    // install pipeline end-to-end.
    const installedAt = new Date().toISOString();
    const wcInstance = {
      manifest: wordCounter.manifest,
      status: 'installed' as const,
      installPath: `${INSTALL_ROOT}/${wordCounter.manifest.id}`,
      lastError: null,
      installedAt,
      enabledAt: null,
    };
    const crInstance = {
      manifest: crashing.manifest,
      status: 'installed' as const,
      installPath: `${INSTALL_ROOT}/${crashing.manifest.id}`,
      lastError: null,
      installedAt,
      enabledAt: null,
    };
    // PluginManager keeps its own in-memory map; reach in via the only public
    // surface that mutates it (installedPlugins map is private). The cleanest
    // injection is to pre-seed the underlying map by going through the same
    // contract the production install flow uses, but that requires a Tauri
    // tarball stub. Use a dedicated test seeder instead: cast to a setter.
    const internal = manager as unknown as {
      installedPlugins: Map<string, typeof wcInstance>;
      syncStore?: () => void;
    };
    internal.installedPlugins.set(wordCounter.manifest.id, wcInstance);
    internal.installedPlugins.set(crashing.manifest.id, crInstance);
    usePluginManagerStore.getState().setInstalled([wcInstance, crInstance]);

    // ---- Enable word-counter ---------------------------------------------
    await manager.enable(wordCounter.manifest.id);
    expect(manager.getStatus(wordCounter.manifest.id)).toBe('enabled');

    // The plugin's activate() runs asynchronously inside the runtime; wait
    // for the registry to reflect every contribution.
    await waitFor(
      () =>
        usePluginRegistryStore.getState().toolbar.some((b) => b.id === 'wc-button') &&
        usePluginRegistryStore.getState().sidebar.some((p) => p.id === 'wc-panel') &&
        usePluginRegistryStore.getState().commands.has('word-counter.count'),
    );

    // Toolbar contribution
    const toolbar = usePluginRegistryStore.getState().toolbar;
    const wcButton = toolbar.find((b) => b.id === 'wc-button');
    expect(wcButton).toBeDefined();
    expect(wcButton?.pluginId).toBe('word-counter');
    expect(wcButton?.command).toBe('word-counter.count');

    // Sidebar contribution. The renderer puts `html` inside the iframe srcdoc,
    // so the spec carries the same string we'll later read from
    // `iframe.getAttribute('srcdoc')` at render time.
    const sidebar = usePluginRegistryStore.getState().sidebar;
    const wcPanel = sidebar.find((p) => p.id === 'wc-panel');
    expect(wcPanel).toBeDefined();
    expect(wcPanel?.pluginId).toBe('word-counter');
    expect(wcPanel?.html).toBeTruthy();
    expect(wcPanel?.html).toContain('Word Counter');

    // Command registered
    const command = usePluginRegistryStore.getState().commands.get('word-counter.count');
    expect(command).toBeDefined();
    expect(command?.pluginId).toBe('word-counter');

    // ---- Invoke the command via the manager (toolbar-click code path) ----
    const result = (await manager.invokeCommand(
      wordCounter.manifest.id,
      'word-counter.count',
    )) as { words: number; characters: number };
    expect(result).toBeDefined();
    expect(result.words).toBe(8);
    expect(result.characters).toBe(activeContent.length);

    // The notify host audits every notify.* call as plugin_executed; the
    // word-counter plugin issues a notify.info inside the command handler,
    // so we should find a plugin_executed event tagged with notify.info.
    await waitFor(() =>
      auditService
        .getAll()
        .some(
          (e) =>
            e.action === 'plugin_executed' &&
            (e.metadata as { id?: string; command?: string } | undefined)?.id === 'word-counter',
        ),
    );

    // Mutate the editor to a different value and re-invoke; we should see the
    // updated count without rebuilding the plugin.
    activeContent = 'one two three';
    const result2 = (await manager.invokeCommand(
      wordCounter.manifest.id,
      'word-counter.count',
    )) as { words: number; characters: number };
    expect(result2.words).toBe(3);

    // ---- Crash the second plugin ----------------------------------------
    // crashing-plugin throws inside `activate`; the runtime catches the throw
    // and posts an `error` message. PluginWorkerHost flips status to
    // `crashed` and emits `plugin_crashed`.
    await manager.enable(crashing.manifest.id);

    await waitFor(() => selectStatus(crashing.manifest.id)(usePluginManagerStore.getState()) === 'crashed');
    expect(usePluginManagerStore.getState().errorsByPluginId[crashing.manifest.id]).toContain('boom');
    expect(
      auditService
        .getAll()
        .some((e) => e.action === 'plugin_crashed' && (e.metadata as { id?: string }).id === 'crashing-plugin'),
    ).toBe(true);

    // Restart the crashed plugin. After restart the bridge has been recreated
    // and the runtime has been re-seeded with the same source — which throws
    // again, so the status flips back to `crashed`. The point of the assertion
    // is that restart is callable without throwing on the host side.
    await manager.restart(crashing.manifest.id);
    await waitFor(() => selectStatus(crashing.manifest.id)(usePluginManagerStore.getState()) === 'crashed');

    // ---- Uninstall word-counter -----------------------------------------
    await manager.uninstall(wordCounter.manifest.id);
    expect(manager.listInstalled().some((p) => p.manifest.id === 'word-counter')).toBe(false);
    expect(usePluginRegistryStore.getState().toolbar.some((b) => b.id === 'wc-button')).toBe(false);
    expect(usePluginRegistryStore.getState().sidebar.some((p) => p.id === 'wc-panel')).toBe(false);
    expect(usePluginRegistryStore.getState().commands.has('word-counter.count')).toBe(false);

    // Per spec, data/ is preserved on uninstall. The fixture didn't write any
    // data so we just confirm the manifest + source are gone.
    expect(fakeFs.files.has(`${INSTALL_ROOT}/word-counter/manifest.json`)).toBe(false);
    expect(fakeFs.files.has(`${INSTALL_ROOT}/word-counter/index.js`)).toBe(false);
  });
});

// Reference imports kept for type checkers; PluginAPIBridge / PluginBridgeHooks
// are part of the public surface this test indirectly exercises through the
// PluginManager.
type _Refs = [PluginAPIBridge, PluginBridgeHooks];
const _refsKeepalive: _Refs | undefined = undefined;
void _refsKeepalive;
