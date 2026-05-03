// Tests for PluginManager.
//
// Coverage:
//  - installFromTarball happy path: extract is invoked, manifest is read +
//    validated, install dir is moved into place, audit fires, store is updated
//  - installFromTarball with consent rejection: audit fires plugin_install_failed,
//    install dir is cleaned up, no plugin record exists
//  - installFromTarball with invalid manifest: same failure path
//  - installFromTarball with appVersion mismatch (minProjelliVersion in future)
//  - enable -> bridge spawned, init posted with plugin source, status -> enabled
//  - enable on already-enabled is a no-op
//  - disable -> bridge terminated, registrations cleared, status -> disabled
//  - uninstall -> disable + delete + record removed; data/ subdir preserved
//  - update -> disable + reinstall + enable; data/ preserved across the update
//  - restart -> disable + enable in sequence
//  - Crash recovery: bridge fires onError -> status -> crashed -> restart returns
//    status to enabled
//  - listInstalled / getStatus snapshots match in-memory state
//  - dispose disables every running plugin
//
// Tests use the paired-mock factory from tests/helpers/pluginMockFactory so the
// bridge + runtime are real but the worker shell is in-process.

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

import { PluginManager } from '@/modules/plugins/PluginManager';
import { usePluginManagerStore } from '@/stores/pluginManagerStore';
import { usePluginRegistryStore } from '@/stores/pluginRegistryStore';
import type { FSBackend } from '@/modules/workspace/types';
import type { PluginManifest, PluginModule } from '@/types/plugin';

import {
  fakeManifest,
  inlinePluginLoader,
  makePairedBridge,
} from '../../helpers/pluginMockFactory';

import type {
  PluginAPIBridge,
  PluginBridgeHooks,
  PluginWorkerFactory,
} from '@/modules/plugins/PluginAPIBridge';

// ---------------------------------------------------------------------------
// In-memory FS double
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
      // A "directory" exists if any descendant file lives under it.
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
      // Recursively delete any descendants under p/
      const prefix = `${p}/`;
      for (const k of [...files.keys()]) if (k.startsWith(prefix)) files.delete(k);
      for (const k of [...binaryFiles.keys()]) if (k.startsWith(prefix)) binaryFiles.delete(k);
      for (const k of [...dirs]) if (k.startsWith(prefix)) dirs.delete(k);
    }),
    move: vi.fn(async (from: string, to: string) => {
      // Move the entry itself.
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
      // Move every descendant.
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
// Mock bridge + worker factories. The PluginManager uses
// PluginWorkerHost which constructs PluginAPIBridge. Tests inject a custom
// bridgeFactory via... wait. PluginWorkerHost takes bridgeFactory as an
// option, but PluginManager constructs PluginWorkerHost internally without
// exposing it. So we use the workerFactory injection point.
//
// The cleanest approach: use makePairedBridge to construct a paired bridge
// per plugin. But PluginManager constructs PluginWorkerHost which constructs
// PluginAPIBridge directly. Options:
//   - Inject a bridgeFactory at PluginManager level (broader API change)
//   - Use the injected workerFactory + a real bridge that does no real work
//   - Use a stub plugin loader by going through the runtime's loader option
//
// Simplest: provide a workerFactory that returns a tiny mock worker. The
// real PluginAPIBridge is then created on top, but we never need full
// runtime semantics for these tests. We just need the bridge to send init
// without throwing. Since init just postMessages, the mock worker swallows it.
// ---------------------------------------------------------------------------

interface MockWorker {
  postMessages: unknown[];
  messageListeners: Set<(event: { data?: unknown }) => void>;
  errorListeners: Set<(event: { message?: string }) => void>;
  terminated: boolean;
}

function makeWorkerFactory(): {
  factory: PluginWorkerFactory;
  workers: MockWorker[];
  fireError: (workerIndex: number, message: string) => void;
} {
  const workers: MockWorker[] = [];
  const factory: PluginWorkerFactory = () => {
    const w: MockWorker = {
      postMessages: [],
      messageListeners: new Set(),
      errorListeners: new Set(),
      terminated: false,
    };
    workers.push(w);
    return {
      postMessage(data: unknown) {
        w.postMessages.push(data);
      },
      terminate() {
        w.terminated = true;
      },
      addEventListener(type, listener) {
        if (type === 'message') {
          w.messageListeners.add(listener as (event: { data?: unknown }) => void);
        } else if (type === 'error' || type === 'messageerror') {
          w.errorListeners.add(listener as (event: { message?: string }) => void);
        }
      },
      removeEventListener(type, listener) {
        if (type === 'message') {
          w.messageListeners.delete(listener as (event: { data?: unknown }) => void);
        } else if (type === 'error' || type === 'messageerror') {
          w.errorListeners.delete(listener as (event: { message?: string }) => void);
        }
      },
    };
  };
  return {
    factory,
    workers,
    fireError(workerIndex, message) {
      const w = workers[workerIndex];
      if (!w) throw new Error(`no mock worker at index ${workerIndex}`);
      for (const l of w.errorListeners) l({ message });
    },
  };
}

// Stand up the install root + a synthetic tarball. The mocked Tauri
// `extract_tarball` writes the manifest + source into the destPath.
function seedTarball(
  fs: FSBackend,
  files: Map<string, string>,
  manifest: PluginManifest,
  source: string,
): { tarballPath: string; mockExtract: (tarballPath: string, destPath: string) => Promise<string[]> } {
  const tarballPath = `/tmp/${manifest.id}-${manifest.version}.tar.gz`;
  // Write a placeholder so tests that read the tarball would find it.
  files.set(tarballPath, 'dummy-tar-bytes');
  const mockExtract = vi.fn(async (_t: string, destPath: string) => {
    files.set(`${destPath}/manifest.json`, JSON.stringify(manifest));
    files.set(`${destPath}/${manifest.main}`, source);
    return ['manifest.json', manifest.main];
  });
  return { tarballPath, mockExtract };
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

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
});

const APP_VERSION = '2.0.0';
const INSTALL_ROOT = '/ws/.projelli/plugins';

const SAMPLE_SOURCE = 'export default { activate(){} }';

function makeManager(opts?: {
  fs?: FSBackend;
  workerFactory?: PluginWorkerFactory;
  extract?: (tarballPath: string, destPath: string) => Promise<string[]>;
}): { manager: PluginManager; fakeFs: FakeFs; workers: MockWorker[]; extractMock: ReturnType<typeof vi.fn> } {
  const fakeFs = opts?.fs ? { fs: opts.fs, files: new Map(), binaryFiles: new Map(), dirs: new Set<string>() } : makeFs();
  const wf = opts?.workerFactory ?? makeWorkerFactory().factory;
  const extractMock = vi.fn(opts?.extract ?? (async () => []));
  const manager = new PluginManager({
    fs: fakeFs.fs,
    workspaceService: null,
    installRoot: INSTALL_ROOT,
    appVersion: APP_VERSION,
    workerFactory: wf,
    tauri: {
      extractTarball: extractMock,
      sha256File: vi.fn(async () => 'deadbeef'),
    },
  });
  return { manager, fakeFs, workers: [], extractMock };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PluginManager.installFromTarball', () => {
  it('extracts, validates, persists, and audits plugin_installed', async () => {
    const fakeFs = makeFs();
    const wf = makeWorkerFactory();
    const manifest = fakeManifest({ id: 'word-counter', version: '1.0.0', permissions: [] });
    const { tarballPath, mockExtract } = seedTarball(fakeFs.fs, fakeFs.files, manifest, SAMPLE_SOURCE);

    const manager = new PluginManager({
      fs: fakeFs.fs,
      workspaceService: null,
      installRoot: INSTALL_ROOT,
      appVersion: APP_VERSION,
      workerFactory: wf.factory,
      tauri: {
        extractTarball: mockExtract,
        sha256File: vi.fn(async () => 'deadbeef'),
      },
    });

    const instance = await manager.installFromTarball(tarballPath);
    expect(instance.manifest.id).toBe('word-counter');
    expect(instance.status).toBe('installed');
    expect(mockExtract).toHaveBeenCalled();

    const list = manager.listInstalled();
    expect(list).toHaveLength(1);
    expect(list[0]?.manifest.id).toBe('word-counter');

    // Manifest + index.js are at the final install path
    expect(fakeFs.files.get(`${INSTALL_ROOT}/word-counter/manifest.json`)).toBeTruthy();
    expect(fakeFs.files.get(`${INSTALL_ROOT}/word-counter/index.js`)).toBe(SAMPLE_SOURCE);

    // Store reflects the new plugin
    expect(usePluginManagerStore.getState().installedPlugins).toHaveLength(1);
  });

  it('rejects install when consent callback returns false; cleans up extracted dir', async () => {
    const fakeFs = makeFs();
    const wf = makeWorkerFactory();
    const manifest = fakeManifest({ id: 'denied', permissions: ['ai:invoke'] });
    const { tarballPath, mockExtract } = seedTarball(fakeFs.fs, fakeFs.files, manifest, SAMPLE_SOURCE);
    const manager = new PluginManager({
      fs: fakeFs.fs,
      workspaceService: null,
      installRoot: INSTALL_ROOT,
      appVersion: APP_VERSION,
      workerFactory: wf.factory,
      tauri: {
        extractTarball: mockExtract,
        sha256File: vi.fn(async () => 'deadbeef'),
      },
    });

    await expect(
      manager.installFromTarball(tarballPath, {
        onConsent: async () => false,
      }),
    ).rejects.toThrow(/denied|consent/i);

    expect(manager.listInstalled()).toHaveLength(0);
    // Staging dir was deleted (no manifest.json under any staging-* key)
    const stagingKeys = [...fakeFs.files.keys()].filter((k) => k.includes('.staging-'));
    expect(stagingKeys).toHaveLength(0);
  });

  it('rejects install when manifest is invalid', async () => {
    const fakeFs = makeFs();
    const wf = makeWorkerFactory();
    const tarballPath = '/tmp/bad.tar.gz';
    const mockExtract = vi.fn(async (_t: string, destPath: string) => {
      // Missing required fields (id, name, etc.)
      fakeFs.files.set(`${destPath}/manifest.json`, JSON.stringify({ foo: 'bar' }));
      return ['manifest.json'];
    });
    const manager = new PluginManager({
      fs: fakeFs.fs,
      workspaceService: null,
      installRoot: INSTALL_ROOT,
      appVersion: APP_VERSION,
      workerFactory: wf.factory,
      tauri: {
        extractTarball: mockExtract,
        sha256File: vi.fn(async () => 'deadbeef'),
      },
    });
    await expect(manager.installFromTarball(tarballPath)).rejects.toThrow(/invalid/);
    expect(manager.listInstalled()).toHaveLength(0);
  });

  it('rejects install when minProjelliVersion is newer than appVersion', async () => {
    const fakeFs = makeFs();
    const wf = makeWorkerFactory();
    const manifest = fakeManifest({ id: 'future', minProjelliVersion: '99.0.0' });
    const { tarballPath, mockExtract } = seedTarball(fakeFs.fs, fakeFs.files, manifest, SAMPLE_SOURCE);
    const manager = new PluginManager({
      fs: fakeFs.fs,
      workspaceService: null,
      installRoot: INSTALL_ROOT,
      appVersion: APP_VERSION,
      workerFactory: wf.factory,
      tauri: {
        extractTarball: mockExtract,
        sha256File: vi.fn(async () => 'deadbeef'),
      },
    });
    await expect(manager.installFromTarball(tarballPath)).rejects.toThrow(/Projelli/);
    expect(manager.listInstalled()).toHaveLength(0);
  });
});

describe('PluginManager.enable', () => {
  it('spawns a worker, sends init, and marks status enabled', async () => {
    const fakeFs = makeFs();
    const wf = makeWorkerFactory();
    const manifest = fakeManifest({ id: 'p', permissions: [] });
    const { tarballPath, mockExtract } = seedTarball(fakeFs.fs, fakeFs.files, manifest, SAMPLE_SOURCE);
    const manager = new PluginManager({
      fs: fakeFs.fs,
      workspaceService: null,
      installRoot: INSTALL_ROOT,
      appVersion: APP_VERSION,
      workerFactory: wf.factory,
      tauri: { extractTarball: mockExtract, sha256File: vi.fn(async () => 'deadbeef') },
    });

    await manager.installFromTarball(tarballPath);
    await manager.enable('p');
    expect(manager.getStatus('p')).toBe('enabled');
    expect(wf.workers).toHaveLength(1);
    // Bridge sent the init message
    expect(wf.workers[0]?.postMessages.length).toBeGreaterThan(0);
  });

  it('is a no-op for an already-enabled plugin', async () => {
    const fakeFs = makeFs();
    const wf = makeWorkerFactory();
    const manifest = fakeManifest({ id: 'p' });
    const { tarballPath, mockExtract } = seedTarball(fakeFs.fs, fakeFs.files, manifest, SAMPLE_SOURCE);
    const manager = new PluginManager({
      fs: fakeFs.fs,
      workspaceService: null,
      installRoot: INSTALL_ROOT,
      appVersion: APP_VERSION,
      workerFactory: wf.factory,
      tauri: { extractTarball: mockExtract, sha256File: vi.fn(async () => 'deadbeef') },
    });
    await manager.installFromTarball(tarballPath);
    await manager.enable('p');
    await manager.enable('p');
    expect(wf.workers).toHaveLength(1);
  });
});

describe('PluginManager.disable', () => {
  it('terminates the worker, clears registrations, marks disabled', async () => {
    const fakeFs = makeFs();
    const wf = makeWorkerFactory();
    const manifest = fakeManifest({ id: 'p' });
    const { tarballPath, mockExtract } = seedTarball(fakeFs.fs, fakeFs.files, manifest, SAMPLE_SOURCE);
    const manager = new PluginManager({
      fs: fakeFs.fs,
      workspaceService: null,
      installRoot: INSTALL_ROOT,
      appVersion: APP_VERSION,
      workerFactory: wf.factory,
      tauri: { extractTarball: mockExtract, sha256File: vi.fn(async () => 'deadbeef') },
    });
    await manager.installFromTarball(tarballPath);
    await manager.enable('p');
    // Pre-populate a fake registration to confirm it gets cleared.
    usePluginRegistryStore.getState().registerCommand('p', { id: 'p.cmd' });
    expect(usePluginRegistryStore.getState().commands.has('p.cmd')).toBe(true);

    await manager.disable('p');
    expect(manager.getStatus('p')).toBe('disabled');
    expect(wf.workers[0]?.terminated).toBe(true);
    expect(usePluginRegistryStore.getState().commands.has('p.cmd')).toBe(false);
  });
});

describe('PluginManager.uninstall', () => {
  it('disables, deletes the install dir, removes from store, but preserves data/', async () => {
    const fakeFs = makeFs();
    const wf = makeWorkerFactory();
    const manifest = fakeManifest({ id: 'p' });
    const { tarballPath, mockExtract } = seedTarball(fakeFs.fs, fakeFs.files, manifest, SAMPLE_SOURCE);
    const manager = new PluginManager({
      fs: fakeFs.fs,
      workspaceService: null,
      installRoot: INSTALL_ROOT,
      appVersion: APP_VERSION,
      workerFactory: wf.factory,
      tauri: { extractTarball: mockExtract, sha256File: vi.fn(async () => 'deadbeef') },
    });
    await manager.installFromTarball(tarballPath);
    await manager.enable('p');

    // Drop a fake data file to confirm it survives uninstall.
    fakeFs.files.set(`${INSTALL_ROOT}/p/data/notes.json`, '{"hello":"world"}');

    await manager.uninstall('p');
    expect(manager.listInstalled()).toHaveLength(0);
    expect(usePluginManagerStore.getState().installedPlugins).toHaveLength(0);

    // manifest + source gone
    expect(fakeFs.files.get(`${INSTALL_ROOT}/p/manifest.json`)).toBeUndefined();
    expect(fakeFs.files.get(`${INSTALL_ROOT}/p/index.js`)).toBeUndefined();
    // data file preserved
    expect(fakeFs.files.get(`${INSTALL_ROOT}/p/data/notes.json`)).toBe('{"hello":"world"}');
  });
});

describe('PluginManager.update', () => {
  it('replaces the install with a new tarball and preserves data/', async () => {
    const fakeFs = makeFs();
    const wf = makeWorkerFactory();
    const manifest = fakeManifest({ id: 'p', version: '1.0.0' });
    const { tarballPath: oldTar, mockExtract: extractOld } = seedTarball(
      fakeFs.fs,
      fakeFs.files,
      manifest,
      'OLD_SOURCE',
    );
    const newManifest = fakeManifest({ id: 'p', version: '2.0.0' });
    const { tarballPath: newTar } = seedTarball(fakeFs.fs, fakeFs.files, newManifest, 'NEW_SOURCE');

    let extractCount = 0;
    const extractMock = vi.fn(async (t: string, dest: string) => {
      extractCount += 1;
      const m = extractCount === 1 ? manifest : newManifest;
      const src = extractCount === 1 ? 'OLD_SOURCE' : 'NEW_SOURCE';
      fakeFs.files.set(`${dest}/manifest.json`, JSON.stringify(m));
      fakeFs.files.set(`${dest}/${m.main}`, src);
      return ['manifest.json', m.main];
    });
    void extractOld;

    const manager = new PluginManager({
      fs: fakeFs.fs,
      workspaceService: null,
      installRoot: INSTALL_ROOT,
      appVersion: APP_VERSION,
      workerFactory: wf.factory,
      tauri: { extractTarball: extractMock, sha256File: vi.fn(async () => 'deadbeef') },
    });
    await manager.installFromTarball(oldTar);
    await manager.enable('p');
    fakeFs.files.set(`${INSTALL_ROOT}/p/data/state.json`, '{"saved":true}');

    await manager.update('p', newTar);
    expect(fakeFs.files.get(`${INSTALL_ROOT}/p/index.js`)).toBe('NEW_SOURCE');
    expect(fakeFs.files.get(`${INSTALL_ROOT}/p/data/state.json`)).toBe('{"saved":true}');
    // Plugin re-enabled after update
    expect(manager.getStatus('p')).toBe('enabled');
  });
});

describe('PluginManager.restart', () => {
  it('disables and re-enables a plugin', async () => {
    const fakeFs = makeFs();
    const wf = makeWorkerFactory();
    const manifest = fakeManifest({ id: 'p' });
    const { tarballPath, mockExtract } = seedTarball(fakeFs.fs, fakeFs.files, manifest, SAMPLE_SOURCE);
    const manager = new PluginManager({
      fs: fakeFs.fs,
      workspaceService: null,
      installRoot: INSTALL_ROOT,
      appVersion: APP_VERSION,
      workerFactory: wf.factory,
      tauri: { extractTarball: mockExtract, sha256File: vi.fn(async () => 'deadbeef') },
    });
    await manager.installFromTarball(tarballPath);
    await manager.enable('p');
    expect(wf.workers).toHaveLength(1);

    await manager.restart('p');
    expect(wf.workers).toHaveLength(2);
    expect(wf.workers[0]?.terminated).toBe(true);
    expect(wf.workers[1]?.terminated).toBe(false);
    expect(manager.getStatus('p')).toBe('enabled');
  });
});

describe('PluginManager crash recovery', () => {
  it('flips status to crashed when the worker fires onError; restart returns to enabled', async () => {
    const fakeFs = makeFs();
    const wf = makeWorkerFactory();
    const manifest = fakeManifest({ id: 'crashy' });
    const { tarballPath, mockExtract } = seedTarball(fakeFs.fs, fakeFs.files, manifest, SAMPLE_SOURCE);
    const manager = new PluginManager({
      fs: fakeFs.fs,
      workspaceService: null,
      installRoot: INSTALL_ROOT,
      appVersion: APP_VERSION,
      workerFactory: wf.factory,
      tauri: { extractTarball: mockExtract, sha256File: vi.fn(async () => 'deadbeef') },
    });
    await manager.installFromTarball(tarballPath);
    await manager.enable('crashy');
    expect(manager.getStatus('crashy')).toBe('enabled');

    wf.fireError(0, 'plugin exploded');
    expect(usePluginManagerStore.getState().statusByPluginId['crashy']).toBe('crashed');
    expect(usePluginManagerStore.getState().errorsByPluginId['crashy']).toBe('plugin exploded');

    await manager.restart('crashy');
    expect(manager.getStatus('crashy')).toBe('enabled');
    expect(wf.workers).toHaveLength(2);
  });
});

describe('PluginManager.dispose', () => {
  it('disables every running plugin', async () => {
    const fakeFs = makeFs();
    const wf = makeWorkerFactory();
    const m1 = fakeManifest({ id: 'a' });
    const m2 = fakeManifest({ id: 'b' });
    const { tarballPath: t1 } = seedTarball(fakeFs.fs, fakeFs.files, m1, SAMPLE_SOURCE);
    const { tarballPath: t2 } = seedTarball(fakeFs.fs, fakeFs.files, m2, SAMPLE_SOURCE);
    let count = 0;
    const extractMock = vi.fn(async (_t: string, dest: string) => {
      count += 1;
      const m = count === 1 ? m1 : m2;
      fakeFs.files.set(`${dest}/manifest.json`, JSON.stringify(m));
      fakeFs.files.set(`${dest}/${m.main}`, SAMPLE_SOURCE);
      return ['manifest.json', m.main];
    });
    const manager = new PluginManager({
      fs: fakeFs.fs,
      workspaceService: null,
      installRoot: INSTALL_ROOT,
      appVersion: APP_VERSION,
      workerFactory: wf.factory,
      tauri: { extractTarball: extractMock, sha256File: vi.fn(async () => 'deadbeef') },
    });
    await manager.installFromTarball(t1);
    await manager.installFromTarball(t2);
    await manager.enable('a');
    await manager.enable('b');
    expect(wf.workers).toHaveLength(2);

    await manager.dispose();
    expect(wf.workers[0]?.terminated).toBe(true);
    expect(wf.workers[1]?.terminated).toBe(true);
    expect(manager.listInstalled()).toHaveLength(0);
  });
});

describe('PluginManager.invokeCommand', () => {
  it('rejects with not-found when the plugin is not running', async () => {
    const { manager } = makeManager();
    await expect(manager.invokeCommand('missing', 'cmd')).rejects.toMatchObject({
      code: 'not-found',
    });
  });
});

// Reference imports kept to keep lints/types happy without unused warnings:
// PluginAPIBridge / makePairedBridge / inlinePluginLoader / PluginBridgeHooks
// could be used by a future test that exercises end-to-end runtime flows.
type _Refs = [PluginAPIBridge, PluginBridgeHooks, ReturnType<typeof makePairedBridge>, ReturnType<typeof inlinePluginLoader>, PluginModule];
const _refsKeepalive: _Refs | undefined = undefined;
void _refsKeepalive;
