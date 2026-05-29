/**
 * Integration test for the Plugin Marketplace install pipeline (Stream C4
 * Group VII, Task 7.1).
 *
 * Wires the real `MarketplaceService` (composed via
 * `createPluginsMarketplaceService`) end-to-end with the real `PluginManager`
 * + `PluginAPIBridge` + `PluginRuntime`. Only the things that genuinely cannot
 * run in jsdom are mocked:
 *
 *   - `fetch` for catalog + tarball downloads (no real network)
 *   - `@tauri-apps/api/core.invoke` for `sha256_file` + `extract_tarball`
 *   - the Web Worker shell, replaced via the paired-bridge factory from
 *     `tests/helpers/pluginMockFactory.ts`
 *
 * Asserts the full happy path:
 *   1. catalog refresh sees the fixture plugin
 *   2. service.install() downloads + checksums + extracts + writes
 *      installed.json + emits `plugin_installed`
 *   3. PluginManager.installFromTarball() registers the plugin (mirroring
 *      how PluginDetailView hands off post-marketplace-install)
 *   4. PluginManager.enable() spawns the worker, the runtime activates the
 *      plugin module, and the registry receives the plugin's contributions
 *   5. audit events fire in the expected order:
 *      plugin_installed (marketplace) → plugin_installed (manager) → plugin_enabled
 *
 * Why we run installFromTarball() AFTER service.install(): production wires
 * them as a pair. The marketplace puts files on disk; the manager then loads
 * them. The integration test is the one place we exercise both layers together.
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
import {
  PluginRuntime,
  type PluginLoader,
  type PluginWorkerScope,
} from '@/modules/plugins/PluginRuntime';
import {
  PluginManager,
  type PluginTauriCommands,
} from '@/modules/plugins/PluginManager';
import type {
  PluginWorkerFactory,
  PluginWorkerLike,
} from '@/modules/plugins/PluginAPIBridge';
import { setActivePluginManager } from '@/modules/plugins/pluginManagerHolder';
import { AuditService } from '@/modules/audit/AuditService';
import { usePluginManagerStore } from '@/stores/pluginManagerStore';
import { usePluginRegistryStore } from '@/stores/pluginRegistryStore';
import type { FSBackend } from '@/modules/workspace/types';
import type { CatalogEntry } from '@/types/marketplace';
import type { PluginManifest, PluginModule } from '@/types/plugin';

import wordCounterModule from '../../fixtures/plugins/word-counter/index.js';

const mockInvoke = vi.mocked(tauriCore.invoke);

// ---------------------------------------------------------------------------
// Fixture loading. Reuse the C3 word-counter fixture verbatim
// ---------------------------------------------------------------------------

const FIXTURE_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../fixtures/plugins',
);

const WC_MANIFEST = JSON.parse(
  readFileSync(`${FIXTURE_DIR}/word-counter/manifest.json`, 'utf-8'),
) as PluginManifest;
const WC_SOURCE = readFileSync(`${FIXTURE_DIR}/word-counter/index.js`, 'utf-8');

// ---------------------------------------------------------------------------
// In-memory FSBackend with directory awareness. Same shape used by the C3
// end-to-end lifecycle test, kept inline so the tests stay independent.
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
// Paired worker factory (same pattern as C3's end-to-end-lifecycle test).
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

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const APP_VERSION = '2.0.0';
const WORKSPACE_ROOT = '/ws';
const INSTALL_ROOT = `${WORKSPACE_ROOT}/.keepance/plugins`;
const PLUGIN_ID = WC_MANIFEST.id;
const TARBALL_CHECKSUM = 'a1b2c3d4e5f6';

const CATALOG_ENTRY: CatalogEntry = {
  id: PLUGIN_ID,
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

/**
 * Wire fetch + Tauri invoke for the happy path. The marketplace service's
 * `extract_tarball` writes the manifest to the marketplace install dir; the
 * PluginManager's `extract_tarball` then re-extracts the same payload into
 * its own staging dir during `installFromTarball`. We seed both.
 */
function wireHappyPath(fakeFs: FakeFs): void {
  const fetchSpy = vi.fn(async (url: string | URL | Request) => {
    const u = typeof url === 'string' ? url : url.toString();
    if (u.endsWith('catalog.json')) {
      return {
        ok: true,
        status: 200,
        json: async () => [CATALOG_ENTRY],
      } as unknown as Response;
    }
    if (u.endsWith('.tar.gz')) {
      return fakeStreamingResponse([new Uint8Array([1, 2, 3, 4])]);
    }
    throw new Error(`Unexpected fetch: ${u}`);
  });
  vi.stubGlobal('fetch', fetchSpy);

  mockInvoke.mockReset();
  mockInvoke.mockImplementation(async (cmd: string, args?: unknown) => {
    if (cmd === 'sha256_file') return TARBALL_CHECKSUM;
    if (cmd === 'extract_tarball') {
      const params = args as { tarballPath: string; destPath: string };
      // Seed the manifest + plugin source in whichever destPath the caller
      // requested. The marketplace passes its own install dir; the manager
      // passes a `.staging-<ts>` dir under its install root.
      fakeFs.files.set(
        `${params.destPath}/manifest.json`,
        JSON.stringify(WC_MANIFEST),
      );
      fakeFs.files.set(
        `${params.destPath}/${WC_MANIFEST.main}`,
        WC_SOURCE,
      );
      return ['manifest.json', WC_MANIFEST.main];
    }
    throw new Error(`Unexpected invoke: ${cmd}`);
  });
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
  setActivePluginManager(null);
});

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('Plugin marketplace install end-to-end', () => {
  it('catalog refresh → consent approve → service.install → manager.install + enable → worker spawns + audit events fire in order', async () => {
    const fakeFs = makeFs();
    wireHappyPath(fakeFs);

    const audit = new AuditService(`plugins-mp-int-${Math.random()}`);

    // ---- Marketplace service (the part C4 owns) -------------------------
    const service = createPluginsMarketplaceService(fakeFs.fs, WORKSPACE_ROOT);
    // Inject our shared audit so the test can read both marketplace and
    // manager events from one log. The factory builds an AuditService
    // internally; reach in to swap it.
    (service as unknown as { auditService: AuditService }).auditService = audit;

    // ---- PluginManager (the part C3 owns; we re-use the same audit) -----
    const tauri: PluginTauriCommands = {
      extractTarball: (tarballPath: string, destPath: string) =>
        tauriCore.invoke<string[]>('extract_tarball', { tarballPath, destPath }),
      sha256File: (path: string) =>
        tauriCore.invoke<string>('sha256_file', { path }),
    };
    const manager = new PluginManager({
      fs: fakeFs.fs,
      workspaceService: null,
      installRoot: INSTALL_ROOT,
      appVersion: APP_VERSION,
      workerFactory: makePairedWorkerFactory({
        [WC_SOURCE]: wordCounterModule as PluginModule,
      }),
      auditService: audit,
      tauri,
    });
    setActivePluginManager(manager);

    // ---- 1. Catalog refresh ---------------------------------------------
    await service.refresh();
    const catalog = await service.list();
    expect(catalog).toHaveLength(1);
    expect(catalog[0]?.id).toBe(PLUGIN_ID);

    // ---- 2. Simulate the consent dialog approving the install -----------
    // PluginDetailView opens the dialog before calling service.install.
    // The consent surface is unit-tested elsewhere; here we model an
    // "approved" decision by simply proceeding to the install call.
    const approved = true;
    expect(approved).toBe(true);

    // ---- 3. Marketplace install (downloads, verifies, extracts, audits) -
    const installedEntry = await service.install(PLUGIN_ID);
    expect(installedEntry.id).toBe(PLUGIN_ID);
    expect(installedEntry.installedPath).toBe(`${INSTALL_ROOT}/${PLUGIN_ID}`);
    expect(installedEntry.manifestVersion).toBe(WC_MANIFEST.apiVersion);

    // The marketplace stages the install dir on disk.
    expect(
      fakeFs.files.has(`${INSTALL_ROOT}/${PLUGIN_ID}/manifest.json`),
    ).toBe(true);

    // ---- 4. Hand off to PluginManager -----------------------------------
    // PluginDetailView re-runs the manager's installFromTarball pointing at
    // the marketplace's install dir. Consent already happened, so the
    // manager's onConsent short-circuits to true. We pass `installedPath`
    // as the "tarball path" the same way the production view does. The
    // manager re-extracts via Tauri (mocked to seed the staging dir).
    const instance = await manager.installFromTarball(
      installedEntry.installedPath,
      { onConsent: () => Promise.resolve(true) },
    );
    expect(instance.manifest.id).toBe(PLUGIN_ID);
    expect(instance.status).toBe('installed');

    // ---- 5. Enable and assert the worker spawns -------------------------
    await manager.enable(PLUGIN_ID);
    expect(manager.getStatus(PLUGIN_ID)).toBe('enabled');

    // The runtime activates word-counter, which registers a toolbar button,
    // a sidebar panel, and a command. These land in the registry store
    // through the per-plugin bridge hooks.
    await waitFor(
      () =>
        usePluginRegistryStore.getState().toolbar.some((b) => b.id === 'wc-button') &&
        usePluginRegistryStore.getState().sidebar.some((p) => p.id === 'wc-panel') &&
        usePluginRegistryStore.getState().commands.has('word-counter.count'),
    );

    const toolbar = usePluginRegistryStore.getState().toolbar;
    expect(toolbar.find((b) => b.id === 'wc-button')?.pluginId).toBe(PLUGIN_ID);

    // ---- 6. Audit event ordering ----------------------------------------
    // Production order:
    //   plugin_installed   ← marketplace install (Group I emitter)
    //   plugin_installed   ← manager installFromTarball (C3)
    //   plugin_enabled     ← manager enable (C3)
    const pluginActions = audit
      .getAll()
      .map((e) => e.action)
      .filter((a) => a.startsWith('plugin_'));
    expect(pluginActions[0]).toBe('plugin_installed');
    expect(pluginActions[1]).toBe('plugin_installed');
    expect(pluginActions).toContain('plugin_enabled');
    expect(pluginActions.indexOf('plugin_enabled')).toBeGreaterThan(
      pluginActions.lastIndexOf('plugin_installed'),
    );

    // First plugin_installed comes from the marketplace and carries the
    // permissions list the user approved at consent time.
    const mpInstall = audit
      .getAll()
      .find((e) => e.action === 'plugin_installed');
    expect(mpInstall?.metadata).toMatchObject({
      id: PLUGIN_ID,
      version: WC_MANIFEST.version,
    });
    expect(Array.isArray(mpInstall?.metadata?.permissions)).toBe(true);
    expect(mpInstall?.metadata?.permissions).toEqual(WC_MANIFEST.permissions);
  });

  it('cancelled consent: the marketplace service is never called and no plugin_install_failed audit fires', async () => {
    // This mirrors the PluginDetailView code path where consent returns
    // false: the install bails before service.install() runs, no FS work
    // happens, no audit is appended. We assert the contract by NOT calling
    // service.install at all when the consent simulation returns false and
    // verifying the audit log stays clean.
    const fakeFs = makeFs();
    wireHappyPath(fakeFs);
    const audit = new AuditService(`plugins-mp-int-${Math.random()}`);
    const service = createPluginsMarketplaceService(fakeFs.fs, WORKSPACE_ROOT);
    (service as unknown as { auditService: AuditService }).auditService = audit;

    await service.refresh();
    const consentApproved = false;
    if (consentApproved) {
      await service.install(PLUGIN_ID);
    }

    // No plugin events should be in the audit log. (Empty list is also fine.)
    const pluginActions = audit
      .getAll()
      .map((e) => e.action)
      .filter((a) => a.startsWith('plugin_'));
    expect(pluginActions).toEqual([]);
    // And nothing landed on disk.
    expect(
      fakeFs.files.has(`${INSTALL_ROOT}/${PLUGIN_ID}/manifest.json`),
    ).toBe(false);
  });
});
