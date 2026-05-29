/**
 * Audit log spot-check for the Plugin Marketplace + Manager (Stream C4
 * Group VII, Task 7.3).
 *
 * Drives the full lifecycle the user can hit through the marketplace UI:
 *
 *   - happy install → `plugin_installed`
 *   - manager.uninstall → `plugin_uninstalled`
 *   - failed install (checksum mismatch) → `plugin_install_failed`
 *   - crash recovery (plugin throws in activate, then restart) → `plugin_crashed`
 *
 * Asserts each event fires with the right metadata shape and (where the order
 * is meaningful) the right sequence.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

import * as tauriCore from '@tauri-apps/api/core';
import { createPluginsMarketplaceService } from '@/modules/marketplace/PluginsMarketplaceService';
import { AuditService } from '@/modules/audit/AuditService';
import {
  PluginManager,
  type PluginTauriCommands,
} from '@/modules/plugins/PluginManager';
import {
  PluginRuntime,
  type PluginLoader,
  type PluginWorkerScope,
} from '@/modules/plugins/PluginRuntime';
import type {
  PluginWorkerFactory,
  PluginWorkerLike,
} from '@/modules/plugins/PluginAPIBridge';
import {
  selectStatus,
  usePluginManagerStore,
} from '@/stores/pluginManagerStore';
import { usePluginRegistryStore } from '@/stores/pluginRegistryStore';
import type { FSBackend } from '@/modules/workspace/types';
import type { CatalogEntry } from '@/types/marketplace';
import type { PluginManifest, PluginModule } from '@/types/plugin';

import wordCounterModule from '../fixtures/plugins/word-counter/index.js';
import crashingPluginModule from '../fixtures/plugins/crashing-plugin/index.js';

const mockInvoke = vi.mocked(tauriCore.invoke);

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FIXTURE_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../fixtures/plugins',
);

const WC_MANIFEST = JSON.parse(
  readFileSync(`${FIXTURE_DIR}/word-counter/manifest.json`, 'utf-8'),
) as PluginManifest;
const WC_SOURCE = readFileSync(`${FIXTURE_DIR}/word-counter/index.js`, 'utf-8');

const CRASH_MANIFEST = JSON.parse(
  readFileSync(`${FIXTURE_DIR}/crashing-plugin/manifest.json`, 'utf-8'),
) as PluginManifest;
const CRASH_SOURCE = readFileSync(
  `${FIXTURE_DIR}/crashing-plugin/index.js`,
  'utf-8',
);

const APP_VERSION = '2.0.0';
const WORKSPACE_ROOT = '/ws';
const INSTALL_ROOT = `${WORKSPACE_ROOT}/.keepance/plugins`;
const TARBALL_CHECKSUM = 'a1b2c3d4e5f6';

const WC_ENTRY: CatalogEntry = {
  id: WC_MANIFEST.id,
  name: WC_MANIFEST.name,
  description: WC_MANIFEST.description,
  version: WC_MANIFEST.version,
  author: WC_MANIFEST.author,
  category: WC_MANIFEST.category,
  tags: WC_MANIFEST.tags,
  installUrl: 'https://example.test/word-counter-1.0.0.tar.gz',
  manifestUrl: 'https://example.test/word-counter-1.0.0/manifest.json',
  minKeepanceVersion: WC_MANIFEST.minKeepanceVersion,
  publishedAt: '2026-04-28T00:00:00.000Z',
  updatedAt: '2026-04-28T00:00:00.000Z',
  checksum: TARBALL_CHECKSUM,
};

// ---------------------------------------------------------------------------
// In-memory FS double (same shape as install-from-marketplace-end-to-end)
// ---------------------------------------------------------------------------

interface FakeFs {
  fs: FSBackend;
  files: Map<string, string>;
  binaryFiles: Map<string, Uint8Array>;
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
  return { fs, files, binaryFiles, dirs };
}

// ---------------------------------------------------------------------------
// Paired worker factory. Supports multiple registered plugin sources at once
// (we run the crash-recovery suite alongside the happy-path one).
// ---------------------------------------------------------------------------

function makePairedWorkerFactory(
  modules: Record<string, PluginModule>,
): PluginWorkerFactory {
  const loader: PluginLoader = async (code) => {
    const mod = modules[code];
    if (!mod) {
      throw new Error('paired worker factory: no module registered for plugin source');
    }
    return mod;
  };

  return () => {
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

    new PluginRuntime({ scope, loader });
    return workerLike;
  };
}

function fakeStreamingResponse(chunks: Uint8Array[]): Response {
  const queue = [...chunks];
  const reader = {
    read: vi.fn(async () => {
      const next = queue.shift();
      if (next === undefined) return { done: true, value: undefined };
      return { done: false, value: next };
    }),
    releaseLock: vi.fn(),
  };
  const total = chunks.reduce((sum, c) => sum + c.byteLength, 0);
  return {
    ok: true,
    status: 200,
    body: { getReader: () => reader },
    headers: {
      get: (k: string) =>
        k.toLowerCase() === 'content-length' ? String(total) : null,
    },
  } as unknown as Response;
}

function buildTauri(): PluginTauriCommands {
  return {
    extractTarball: (tarballPath: string, destPath: string) =>
      tauriCore.invoke<string[]>('extract_tarball', { tarballPath, destPath }),
    sha256File: (path: string) =>
      tauriCore.invoke<string>('sha256_file', { path }),
  };
}

async function waitFor(predicate: () => boolean, attempts = 50): Promise<void> {
  for (let i = 0; i < attempts; i += 1) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 0));
  }
  throw new Error('waitFor: predicate did not become true');
}

beforeEach(() => {
  vi.clearAllMocks();
  if (typeof localStorage !== 'undefined') localStorage.clear();
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
});

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('audit log spot-check: plugin marketplace + manager lifecycle', () => {
  it('emits plugin_installed (marketplace) + plugin_uninstalled in order', async () => {
    const fakeFs = makeFs();
    const audit = new AuditService(`plugins-audit-${Math.random()}`);

    // Wire happy fetch + invoke.
    const fetchSpy = vi.fn(async (url: string | URL | Request) => {
      const u = typeof url === 'string' ? url : url.toString();
      if (u.endsWith('catalog.json')) {
        return {
          ok: true,
          status: 200,
          json: async () => [WC_ENTRY],
        } as unknown as Response;
      }
      if (u.endsWith('.tar.gz')) {
        return fakeStreamingResponse([new Uint8Array([1, 2, 3])]);
      }
      throw new Error(`Unexpected fetch: ${u}`);
    });
    vi.stubGlobal('fetch', fetchSpy);

    mockInvoke.mockReset();
    mockInvoke.mockImplementation(async (cmd: string, args?: unknown) => {
      if (cmd === 'sha256_file') return TARBALL_CHECKSUM;
      if (cmd === 'extract_tarball') {
        const params = args as { tarballPath: string; destPath: string };
        fakeFs.files.set(
          `${params.destPath}/manifest.json`,
          JSON.stringify(WC_MANIFEST),
        );
        return ['manifest.json'];
      }
      throw new Error(`Unexpected invoke: ${cmd}`);
    });

    const service = createPluginsMarketplaceService(fakeFs.fs, WORKSPACE_ROOT);
    (service as unknown as { auditService: AuditService }).auditService = audit;

    await service.refresh();
    await service.install(WC_ENTRY.id);
    await service.uninstall(WC_ENTRY.id);

    const pluginActions = audit
      .getAll()
      .map((e) => e.action)
      .filter((a) => a.startsWith('plugin_'));
    expect(pluginActions).toEqual(['plugin_installed', 'plugin_uninstalled']);

    const installEvent = audit
      .getAll()
      .find((e) => e.action === 'plugin_installed');
    expect(installEvent?.metadata).toMatchObject({
      id: WC_ENTRY.id,
      version: WC_ENTRY.version,
    });
    expect(Array.isArray(installEvent?.metadata?.permissions)).toBe(true);

    const uninstallEvent = audit
      .getAll()
      .find((e) => e.action === 'plugin_uninstalled');
    expect(uninstallEvent?.metadata).toMatchObject({ id: WC_ENTRY.id });
  });

  it('emits plugin_install_failed on checksum mismatch with source="marketplace"', async () => {
    const fakeFs = makeFs();
    const audit = new AuditService(`plugins-audit-${Math.random()}`);

    const fetchSpy = vi.fn(async (url: string | URL | Request) => {
      const u = typeof url === 'string' ? url : url.toString();
      if (u.endsWith('catalog.json')) {
        return {
          ok: true,
          status: 200,
          json: async () => [WC_ENTRY],
        } as unknown as Response;
      }
      if (u.endsWith('.tar.gz')) {
        return fakeStreamingResponse([new Uint8Array([9, 9])]);
      }
      throw new Error(`Unexpected fetch: ${u}`);
    });
    vi.stubGlobal('fetch', fetchSpy);

    mockInvoke.mockReset();
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'sha256_file') return 'badhash';
      throw new Error(`Unexpected invoke: ${cmd}`);
    });

    const service = createPluginsMarketplaceService(fakeFs.fs, WORKSPACE_ROOT);
    (service as unknown as { auditService: AuditService }).auditService = audit;

    await service.refresh();
    await expect(service.install(WC_ENTRY.id)).rejects.toThrow(/Checksum/);

    const failedEvent = audit
      .getAll()
      .find((e) => e.action === 'plugin_install_failed');
    expect(failedEvent).toBeDefined();
    expect(failedEvent?.metadata).toMatchObject({
      id: WC_ENTRY.id,
      source: 'marketplace',
    });
    expect(typeof failedEvent?.metadata?.error).toBe('string');
    expect(String(failedEvent?.metadata?.error)).toMatch(/Checksum/);
  });

  it('emits plugin_crashed when a plugin throws in activate, and is restartable without a second crash audit losing the first', async () => {
    const fakeFs = makeFs();
    const audit = new AuditService(`plugins-audit-${Math.random()}`);

    // No marketplace fetches needed; the crash test goes straight through
    // PluginManager. We seed the install dir on disk and the in-memory map
    // (mirroring what installFromTarball would have produced).
    fakeFs.files.set(
      `${INSTALL_ROOT}/${CRASH_MANIFEST.id}/manifest.json`,
      JSON.stringify(CRASH_MANIFEST),
    );
    fakeFs.files.set(
      `${INSTALL_ROOT}/${CRASH_MANIFEST.id}/${CRASH_MANIFEST.main}`,
      CRASH_SOURCE,
    );

    const manager = new PluginManager({
      fs: fakeFs.fs,
      workspaceService: null,
      installRoot: INSTALL_ROOT,
      appVersion: APP_VERSION,
      workerFactory: makePairedWorkerFactory({
        [CRASH_SOURCE]: crashingPluginModule as PluginModule,
        [WC_SOURCE]: wordCounterModule as PluginModule,
      }),
      auditService: audit,
      tauri: buildTauri(),
    });

    // Pre-seed the in-memory installed map so enable() finds the entry.
    const internal = manager as unknown as {
      installedPlugins: Map<string, unknown>;
    };
    internal.installedPlugins.set(CRASH_MANIFEST.id, {
      manifest: CRASH_MANIFEST,
      status: 'installed',
      installPath: `${INSTALL_ROOT}/${CRASH_MANIFEST.id}`,
      lastError: null,
      installedAt: new Date().toISOString(),
      enabledAt: null,
    });

    await manager.enable(CRASH_MANIFEST.id);
    await waitFor(
      () =>
        selectStatus(CRASH_MANIFEST.id)(usePluginManagerStore.getState()) ===
        'crashed',
    );

    const crashEvent = audit
      .getAll()
      .find((e) => e.action === 'plugin_crashed');
    expect(crashEvent).toBeDefined();
    expect(crashEvent?.metadata).toMatchObject({
      id: CRASH_MANIFEST.id,
    });
    expect(typeof crashEvent?.metadata?.error).toBe('string');

    // Restart the plugin; the host re-spawns the worker, the runtime throws
    // again, and a second crash event lands. The point of the assertion is
    // that the first event is preserved in the append-only log.
    await manager.restart(CRASH_MANIFEST.id);
    await waitFor(
      () =>
        selectStatus(CRASH_MANIFEST.id)(usePluginManagerStore.getState()) ===
        'crashed',
    );

    const crashEvents = audit
      .getAll()
      .filter((e) => e.action === 'plugin_crashed');
    expect(crashEvents.length).toBeGreaterThanOrEqual(2);
    // First entry is preserved (append-only contract).
    expect(crashEvents[0]?.metadata).toMatchObject({ id: CRASH_MANIFEST.id });
  });
});
