import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock Tauri invoke BEFORE importing the service so its transitive
// `install.ts` import binds to the mock.
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

import * as tauriCore from '@tauri-apps/api/core';
import { MarketplaceService } from '@/modules/marketplace/MarketplaceService';
import {
  createPluginsMarketplaceService,
  PLUGINS_REPO_URL,
} from '@/modules/marketplace/PluginsMarketplaceService';
import { AuditService } from '@/modules/audit/AuditService';
import type { FSBackend } from '@/modules/workspace/types';
import type { CatalogEntry, InstalledEntry } from '@/types/marketplace';
import type { PluginManifest } from '@/types/plugin';
import {
  validatePluginManifest,
  type PluginManifestValidationResult,
} from '@/modules/plugins/PluginManifestSchema';
import type {
  ManifestValidator,
  ValidatedMarketplaceManifest,
  MarketplaceAuditEmitter,
} from '@/modules/marketplace/MarketplaceService';
import type { PluginPermission } from '@/types/plugin';

const mockInvoke = vi.mocked(tauriCore.invoke);

interface FakeFs {
  fs: FSBackend;
  files: Map<string, string>;
  binaryFiles: Map<string, Uint8Array>;
  spies: {
    read: ReturnType<typeof vi.fn>;
    write: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
    move: ReturnType<typeof vi.fn>;
    writeBinary: ReturnType<typeof vi.fn>;
  };
}

function makeFs(): FakeFs {
  const files = new Map<string, string>();
  const binaryFiles = new Map<string, Uint8Array>();
  const read = vi.fn(async (p: string) => {
    const v = files.get(p);
    if (v === undefined) throw new Error(`ENOENT: ${p}`);
    return v;
  });
  const write = vi.fn(async (p: string, c: string) => {
    files.set(p, c);
  });
  const writeBinary = vi.fn(async (p: string, b: ArrayBuffer) => {
    binaryFiles.set(p, new Uint8Array(b));
  });
  const del = vi.fn(async (p: string) => {
    files.delete(p);
    binaryFiles.delete(p);
  });
  const move = vi.fn(async (from: string, to: string) => {
    const b = binaryFiles.get(from);
    if (b) {
      binaryFiles.set(to, b);
      binaryFiles.delete(from);
    }
    const t = files.get(from);
    if (t !== undefined) {
      files.set(to, t);
      files.delete(from);
    }
  });
  const fs = {
    read,
    readBinary: vi.fn(async (p: string) => (binaryFiles.get(p) ?? new Uint8Array()).buffer),
    write,
    writeBinary,
    exists: vi.fn(async (p: string) => files.has(p) || binaryFiles.has(p)),
    delete: del,
    move,
    copy: vi.fn(),
    rename: vi.fn(),
    mkdir: vi.fn(async () => {}),
    list: vi.fn(),
    stat: vi.fn(),
    isSymlink: vi.fn(),
    resolveSymlink: vi.fn(),
    getRootPath: vi.fn(() => '/ws'),
    setRootPath: vi.fn(),
  } as unknown as FSBackend;
  return {
    fs,
    files,
    binaryFiles,
    spies: { read, write, delete: del, move, writeBinary },
  };
}

const SAMPLE_PERMISSIONS: PluginPermission[] = [
  'workspace:read',
  'editor:selection',
  'ai:invoke',
];

const SAMPLE_ENTRY: CatalogEntry = {
  id: 'word-counter',
  name: 'Word Counter',
  description: 'Live word and character count for the active editor',
  version: '1.0.0',
  author: { name: 'Jameson Daines', githubUser: 'jamesondaines' },
  category: 'productivity',
  tags: ['editor', 'stats'],
  installUrl: 'https://example.test/word-counter.tar.gz',
  manifestUrl: 'https://example.test/manifest.json',
  minProjelliVersion: '2.0.0',
  publishedAt: '2026-04-28T00:00:00.000Z',
  updatedAt: '2026-04-28T00:00:00.000Z',
  checksum: 'deadbeefcafef00d',
};

const SAMPLE_MANIFEST: PluginManifest = {
  id: 'word-counter',
  name: 'Word Counter',
  version: '1.0.0',
  apiVersion: '1.0',
  author: { name: 'Jameson Daines', githubUser: 'jamesondaines' },
  description: 'Live word and character count for the active editor',
  main: 'index.js',
  permissions: SAMPLE_PERMISSIONS,
  minProjelliVersion: '2.0.0',
  category: 'productivity',
  tags: ['editor', 'stats'],
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
      get: (k: string) => (k.toLowerCase() === 'content-length' ? String(total) : null),
    },
  } as unknown as Response;
}

const pluginValidator: ManifestValidator = (raw) => {
  const result: PluginManifestValidationResult = validatePluginManifest(raw);
  if (!result.ok) return { ok: false, errors: result.errors };
  return { ok: true, manifest: result.manifest as unknown as ValidatedMarketplaceManifest };
};

const pluginAuditEmitter: MarketplaceAuditEmitter = {
  installSucceeded: (audit, { id, version, manifest }) => {
    const permissions = (manifest as Partial<PluginManifest>).permissions ?? [];
    audit.append({
      type: 'plugin_installed',
      timestamp: new Date().toISOString(),
      payload: { id, version, permissions: permissions as PluginPermission[] },
    });
  },
  installFailed: (audit, { id, error }) => {
    audit.append({
      type: 'plugin_install_failed',
      timestamp: new Date().toISOString(),
      payload: id ? { id, source: 'marketplace', error } : { source: 'marketplace', error },
    });
  },
  uninstalled: (audit, { id }) => {
    audit.append({
      type: 'plugin_uninstalled',
      timestamp: new Date().toISOString(),
      payload: { id },
    });
  },
  updated: (audit, { id, toVersion }) => {
    audit.append({
      type: 'plugin_installed',
      timestamp: new Date().toISOString(),
      payload: { id, version: toVersion, permissions: [] },
    });
  },
};

/**
 * Build a service pointed at fixed test paths plus a mock fs. Catalog already
 * loaded in-memory so the test doesn't have to call refresh() first. The
 * plugin validator + audit emitter are wired explicitly so the tests exercise
 * the plugin install lifecycle even when constructed without the factory.
 */
function buildService(fs: FakeFs, audit?: AuditService): MarketplaceService {
  const svc = new MarketplaceService({
    repoUrl: 'https://example.test',
    catalogPath: 'catalog.json',
    cachePath: '/ws/.projelli/cache/plugins.json',
    installRoot: '/ws/.projelli/plugins',
    fs: fs.fs,
    provenance: 'community',
    validator: pluginValidator,
    auditEmitter: pluginAuditEmitter,
    ...(audit ? { auditService: audit } : {}),
  });
  // Seed the in-memory cache so `getById` resolves without a network call.
  (svc as unknown as { cache: CatalogEntry[] }).cache = [SAMPLE_ENTRY];
  return svc;
}

/**
 * Wire the standard "happy path" mocks: fetch streams a tarball, Tauri
 * checksum returns matching hash, Tauri extract returns expected file list,
 * fs.read returns a valid plugin manifest.json after extraction.
 */
function wireHappyPath(fs: FakeFs, manifestPath = '/ws/.projelli/plugins/word-counter/manifest.json'): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => fakeStreamingResponse([new Uint8Array([1, 2, 3])])),
  );
  mockInvoke.mockReset();
  mockInvoke.mockImplementation(async (cmd: string) => {
    if (cmd === 'sha256_file') return 'deadbeefcafef00d';
    if (cmd === 'extract_tarball') {
      fs.files.set(manifestPath, JSON.stringify(SAMPLE_MANIFEST));
      return ['manifest.json', 'index.js'];
    }
    throw new Error(`Unexpected invoke: ${cmd}`);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  if (typeof localStorage !== 'undefined') localStorage.clear();
});

describe('PluginsMarketplaceService.install (happy path)', () => {
  it('downloads, verifies, extracts, validates, indexes, and audits', async () => {
    const fs = makeFs();
    const audit = new AuditService(`test-${Math.random()}`);
    const svc = buildService(fs, audit);
    wireHappyPath(fs);

    const installed = await svc.install('word-counter');

    expect(installed.id).toBe('word-counter');
    expect(installed.provenance).toBe('community');
    expect(installed.manifestVersion).toBe('1.0');
    expect(installed.installedPath).toBe('/ws/.projelli/plugins/word-counter');
    expect(installed.installedAt).toBeDefined();

    // installed.json index was written under the plugin install root.
    expect(fs.files.has('/ws/.projelli/plugins/.installed.json')).toBe(true);
    const indexRaw = fs.files.get('/ws/.projelli/plugins/.installed.json')!;
    const index = JSON.parse(indexRaw);
    expect(index.entries).toHaveLength(1);
    expect(index.entries[0].id).toBe('word-counter');

    // Audit emitted the plugin_installed event (not template_*).
    const events = audit.getAll();
    const installEvents = events.filter((e) => e.action === 'plugin_installed');
    expect(installEvents).toHaveLength(1);
    expect(installEvents[0]?.metadata).toMatchObject({
      id: 'word-counter',
      version: '1.0.0',
      permissions: SAMPLE_PERMISSIONS,
    });
    // Should NOT have emitted any template_* events.
    expect(
      events.filter((e) => e.action === 'template_installed_from_marketplace'),
    ).toHaveLength(0);

    // Tarball cleaned up at the temp path.
    expect(
      fs.binaryFiles.has('/ws/.projelli/plugins/.tmp/word-counter.tar.gz'),
    ).toBe(false);
  });

  it('emits onProgress callbacks for every phase', async () => {
    const fs = makeFs();
    const svc = buildService(fs);
    wireHappyPath(fs);

    const phases: Array<[string, number]> = [];
    await svc.install('word-counter', {
      onProgress: (phase, pct) => phases.push([phase, pct]),
    });

    const phaseSet = new Set(phases.map((p) => p[0]));
    expect(phaseSet.has('download')).toBe(true);
    expect(phaseSet.has('checksum')).toBe(true);
    expect(phaseSet.has('extract')).toBe(true);
    expect(phaseSet.has('validate')).toBe(true);
    expect(phaseSet.has('audit')).toBe(true);
    expect(phases).toContainEqual(['extract', 0]);
    expect(phases).toContainEqual(['extract', 100]);
    expect(phases).toContainEqual(['audit', 100]);
  });
});

describe('PluginsMarketplaceService.install (failure paths)', () => {
  it('audits plugin_install_failed and rolls back on checksum mismatch', async () => {
    const fs = makeFs();
    const audit = new AuditService(`test-${Math.random()}`);
    const svc = buildService(fs, audit);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => fakeStreamingResponse([new Uint8Array([9, 9, 9])])),
    );
    mockInvoke.mockReset();
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'sha256_file') return 'wronghash';
      throw new Error(`Unexpected invoke: ${cmd}`);
    });

    await expect(svc.install('word-counter')).rejects.toThrow(/Checksum mismatch/);

    const events = audit.getAll().map((e) => e.action);
    expect(events).toContain('plugin_install_failed');
    expect(events).not.toContain('plugin_installed');
    expect(fs.spies.delete).toHaveBeenCalledWith(
      '/ws/.projelli/plugins/.tmp/word-counter.tar.gz',
    );
    expect(fs.spies.delete).toHaveBeenCalledWith('/ws/.projelli/plugins/word-counter');
    expect(fs.files.has('/ws/.projelli/plugins/.installed.json')).toBe(false);
  });

  it('audits plugin_install_failed when the catalog entry is missing', async () => {
    const fs = makeFs();
    const audit = new AuditService(`test-${Math.random()}`);
    const svc = buildService(fs, audit);
    (svc as unknown as { cache: CatalogEntry[] }).cache = [];

    await expect(svc.install('does-not-exist')).rejects.toThrow(/not found in catalog/);
    const actions = audit.getAll().map((e) => e.action);
    expect(actions).toContain('plugin_install_failed');
  });

  it('audits failure when the extracted manifest is invalid', async () => {
    const fs = makeFs();
    const audit = new AuditService(`test-${Math.random()}`);
    const svc = buildService(fs, audit);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => fakeStreamingResponse([new Uint8Array([1])])),
    );
    mockInvoke.mockReset();
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'sha256_file') return 'deadbeefcafef00d';
      if (cmd === 'extract_tarball') {
        // Plugin manifest missing required `main` field.
        fs.files.set(
          '/ws/.projelli/plugins/word-counter/manifest.json',
          JSON.stringify({ ...SAMPLE_MANIFEST, main: '' }),
        );
        return ['manifest.json'];
      }
      throw new Error(`Unexpected invoke: ${cmd}`);
    });

    await expect(svc.install('word-counter')).rejects.toThrow(/Manifest invalid/);
    const actions = audit.getAll().map((e) => e.action);
    expect(actions).toContain('plugin_install_failed');
  });

  it('proceeds (with warning) when the catalog entry has no checksum', async () => {
    const fs = makeFs();
    const svc = buildService(fs);
    const entryNoChecksum: CatalogEntry = { ...SAMPLE_ENTRY };
    delete (entryNoChecksum as Partial<CatalogEntry>).checksum;
    (svc as unknown as { cache: CatalogEntry[] }).cache = [entryNoChecksum];

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => fakeStreamingResponse([new Uint8Array([1])])),
    );
    mockInvoke.mockReset();
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'extract_tarball') {
        fs.files.set(
          '/ws/.projelli/plugins/word-counter/manifest.json',
          JSON.stringify(SAMPLE_MANIFEST),
        );
        return ['manifest.json'];
      }
      throw new Error(`Unexpected invoke: ${cmd}`);
    });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const installed = await svc.install('word-counter');
    expect(installed.id).toBe('word-counter');
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('No checksum'));
    warnSpy.mockRestore();
  });
});

describe('PluginsMarketplaceService.uninstall', () => {
  it('removes install dir + index entry and audits plugin_uninstalled', async () => {
    const fs = makeFs();
    const audit = new AuditService(`test-${Math.random()}`);
    const svc = buildService(fs, audit);
    wireHappyPath(fs);
    await svc.install('word-counter');

    await svc.uninstall('word-counter');

    expect(fs.spies.delete).toHaveBeenCalledWith('/ws/.projelli/plugins/word-counter');
    const indexRaw = fs.files.get('/ws/.projelli/plugins/.installed.json')!;
    const index = JSON.parse(indexRaw);
    expect(index.entries).toHaveLength(0);
    const events = audit.getAll();
    const uninstallEvents = events.filter((e) => e.action === 'plugin_uninstalled');
    expect(uninstallEvents).toHaveLength(1);
    expect(uninstallEvents[0]?.metadata).toMatchObject({ id: 'word-counter' });
  });

  it('throws if the plugin is not installed', async () => {
    const fs = makeFs();
    const svc = buildService(fs);
    await expect(svc.uninstall('not-installed')).rejects.toThrow(/not installed/);
  });
});

describe('PluginsMarketplaceService.listInstalled', () => {
  it('returns [] when index file is missing', async () => {
    const fs = makeFs();
    const svc = buildService(fs);
    expect(await svc.listInstalled()).toEqual([]);
  });

  it('returns entries from a populated index', async () => {
    const fs = makeFs();
    const svc = buildService(fs);
    wireHappyPath(fs);
    await svc.install('word-counter');
    const list = await svc.listInstalled();
    expect(list).toHaveLength(1);
    expect(list[0]?.id).toBe('word-counter');
    expect(list[0]?.provenance).toBe('community');
  });
});

describe('PluginsMarketplaceService.install (concurrency)', () => {
  it('serializes concurrent install calls for the same id (returns same promise)', async () => {
    const fs = makeFs();
    const audit = new AuditService(`test-${Math.random()}`);
    const svc = buildService(fs, audit);
    wireHappyPath(fs);

    const [a, b] = (await Promise.all([
      svc.install('word-counter'),
      svc.install('word-counter'),
    ])) as [InstalledEntry, InstalledEntry];

    expect(a.installedAt).toBe(b.installedAt);

    const index = JSON.parse(fs.files.get('/ws/.projelli/plugins/.installed.json')!);
    expect(index.entries).toHaveLength(1);

    const successes = audit.getAll().filter((e) => e.action === 'plugin_installed');
    expect(successes).toHaveLength(1);

    const c = await svc.install('word-counter');
    expect(c.id).toBe('word-counter');
  });

  it('clears the in-flight entry after a failure so retry is possible', async () => {
    const fs = makeFs();
    const svc = buildService(fs);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => fakeStreamingResponse([new Uint8Array([1])])),
    );
    mockInvoke.mockReset();
    mockInvoke.mockImplementationOnce(async () => 'wronghash');
    await expect(svc.install('word-counter')).rejects.toThrow(/Checksum/);

    wireHappyPath(fs);
    const installed = await svc.install('word-counter');
    expect(installed.id).toBe('word-counter');
  });
});

describe('createPluginsMarketplaceService factory', () => {
  it('binds the plugins repo URL and workspace-derived paths', async () => {
    const fs = makeFs();
    const svc = createPluginsMarketplaceService(fs.fs, '/ws');

    const fetchSpy = vi.fn(
      async () =>
        ({
          ok: true,
          json: async () => [SAMPLE_ENTRY],
        }) as Response,
    );
    vi.stubGlobal('fetch', fetchSpy);
    await svc.refresh();
    expect(fetchSpy).toHaveBeenCalledWith(`${PLUGINS_REPO_URL}/catalog.json`);

    // Cache path under workspace root, scoped to plugins.
    expect(fs.spies.write).toHaveBeenCalledWith(
      '/ws/.projelli/cache/plugins.json',
      expect.any(String),
    );
  });

  it('strips a trailing slash on the workspace root', async () => {
    const fs = makeFs();
    const svc = createPluginsMarketplaceService(fs.fs, '/ws/');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, json: async () => [] }) as Response),
    );
    await svc.refresh();
    expect(fs.spies.write).toHaveBeenCalledWith(
      '/ws/.projelli/cache/plugins.json',
      expect.any(String),
    );
  });

  it('stamps installed entries with provenance "community"', async () => {
    const fs = makeFs();
    const svc = createPluginsMarketplaceService(fs.fs, '/ws');
    (svc as unknown as { cache: CatalogEntry[] }).cache = [SAMPLE_ENTRY];
    wireHappyPath(fs);
    const installed = await svc.install('word-counter');
    expect(installed.provenance).toBe('community');
  });

  it('emits plugin_installed (not template_*) when wired via the factory', async () => {
    const fs = makeFs();
    const audit = new AuditService(`test-${Math.random()}`);
    const svc = new MarketplaceService({
      repoUrl: 'https://example.test',
      catalogPath: 'catalog.json',
      cachePath: '/ws/.projelli/cache/plugins.json',
      installRoot: '/ws/.projelli/plugins',
      fs: fs.fs,
      provenance: 'community',
      validator: pluginValidator,
      auditEmitter: pluginAuditEmitter,
      auditService: audit,
    });
    (svc as unknown as { cache: CatalogEntry[] }).cache = [SAMPLE_ENTRY];
    wireHappyPath(fs);

    await svc.install('word-counter');

    const actions = audit.getAll().map((e) => e.action);
    expect(actions).toContain('plugin_installed');
    expect(actions).not.toContain('template_installed_from_marketplace');
  });
});
