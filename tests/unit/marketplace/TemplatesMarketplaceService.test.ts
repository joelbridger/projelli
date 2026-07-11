import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock Tauri invoke BEFORE importing the service so its transitive
// `install.ts` import binds to the mock.
const { invokeMock, isTauriMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  isTauriMock: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: invokeMock,
  isTauri: isTauriMock,
}));

import * as tauriCore from '@tauri-apps/api/core';
import { MarketplaceService } from '@/features/workflows/marketplace/svc/MarketplaceService';
import {
  createTemplatesMarketplaceService,
  TEMPLATES_REPO_URL,
} from '@/features/workflows/marketplace/svc/TemplatesMarketplaceService';
import { AuditService } from '@/platform/audit/AuditService';
import type { FSBackend } from '@/platform/fs/types';
import type { CatalogEntry, InstalledEntry } from '@/features/workflows/types/marketplace';
import type { TemplateManifest } from '@/features/workflows/types/templateManifest';

const mockInvoke = vi.mocked(tauriCore.invoke);

function mockNativeCalls(
  handler: (command: string) => unknown | Promise<unknown>,
): void {
  isTauriMock.mockReturnValue(true);
  mockInvoke.mockImplementation(async (command: string) => {
    if (command === 'network_policy_status') {
      return { offlineMode: false, generation: 1 };
    }
    return handler(command);
  });
}

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

const SAMPLE_ENTRY: CatalogEntry = {
  id: 'investor-update-v1',
  name: 'Monthly Investor Update',
  description: 'Monthly update template for early-stage investors',
  version: '1.0.0',
  author: { name: 'Jameson Daines', githubUser: 'jamesondaines' },
  category: 'investor',
  tags: ['investor', 'update', 'monthly'],
  installUrl: 'https://raw.githubusercontent.com/test/community-templates/main/investor.tar.gz',
  manifestUrl: 'https://raw.githubusercontent.com/test/community-templates/main/manifest.json',
  minAppVersion: '2.0.0',
  publishedAt: '2026-04-28T00:00:00.000Z',
  updatedAt: '2026-04-28T00:00:00.000Z',
  checksum: 'deadbeefcafef00d',
};

const SAMPLE_MANIFEST: TemplateManifest = {
  id: 'investor-update-v1',
  name: 'Monthly Investor Update',
  version: '1.0.0',
  apiVersion: '1.0',
  author: { name: 'Jameson Daines', githubUser: 'jamesondaines' },
  description: 'Monthly update template for early-stage investors',
  category: 'investor',
  tags: ['investor', 'update', 'monthly'],
  files: [
    { path: 'template.md', type: 'markdown' },
    { path: 'questions.json', type: 'interview-questions' },
    { path: 'workflow.json', type: 'workflow-definition' },
  ],
  minAppVersion: '2.0.0',
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

/**
 * Build a service pointed at fixed test paths plus a mock fs. Catalog already
 * loaded in-memory so the test doesn't have to call refresh() first.
 */
function buildService(fs: FakeFs, audit?: AuditService): MarketplaceService {
  const svc = new MarketplaceService({
    repoUrl: 'https://raw.githubusercontent.com/test/community-templates/main',
    catalogPath: 'catalog.json',
    cachePath: '/ws/.lantern/cache/templates.json',
    installRoot: '/ws/.lantern/templates',
    fs: fs.fs,
    provenance: 'community',
    ...(audit ? { auditService: audit } : {}),
  });
  // Seed the in-memory cache so `getById` resolves without a network call.
  (svc as unknown as { cache: CatalogEntry[] }).cache = [SAMPLE_ENTRY];
  return svc;
}

/**
 * Wire the standard "happy path" mocks: fetch streams a tarball, Tauri
 * checksum returns matching hash, Tauri extract returns expected file list,
 * fs.read returns a valid manifest.json after extraction.
 */
function wireHappyPath(fs: FakeFs): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => fakeStreamingResponse([new Uint8Array([1, 2, 3])])),
  );
  // First invoke = sha256_file, second = extract_tarball.
  mockInvoke.mockReset();
  mockNativeCalls(async (cmd: string) => {
    if (cmd === 'sha256_file') return 'deadbeefcafef00d';
    if (cmd === 'extract_tarball') {
      // Simulate the Rust extractor placing manifest.json on disk.
      fs.files.set(
        '/ws/.lantern/templates/investor-update-v1/manifest.json',
        JSON.stringify(SAMPLE_MANIFEST),
      );
      return ['manifest.json', 'template.md', 'questions.json', 'workflow.json'];
    }
    throw new Error(`Unexpected invoke: ${cmd}`);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockNativeCalls((command) => {
    throw new Error(`Unexpected invoke: ${command}`);
  });
  // Use a unique workspace id per test so localStorage state doesn't leak.
  if (typeof localStorage !== 'undefined') localStorage.clear();
});

describe('MarketplaceService.install (happy path)', () => {
  it('downloads, verifies, extracts, validates, indexes, and audits', async () => {
    const fs = makeFs();
    const audit = new AuditService(`test-${Math.random()}`);
    const svc = buildService(fs, audit);
    wireHappyPath(fs);

    const installed = await svc.install('investor-update-v1');

    expect(installed.id).toBe('investor-update-v1');
    expect(installed.provenance).toBe('community');
    expect(installed.manifestVersion).toBe('1.0');
    expect(installed.installedPath).toBe('/ws/.lantern/templates/investor-update-v1');
    expect(installed.installedAt).toBeDefined();

    // installed.json index was written.
    expect(fs.files.has('/ws/.lantern/templates/.installed.json')).toBe(true);
    const indexRaw = fs.files.get('/ws/.lantern/templates/.installed.json')!;
    const index = JSON.parse(indexRaw);
    expect(index.entries).toHaveLength(1);
    expect(index.entries[0].id).toBe('investor-update-v1');

    // Audit emitted once.
    const events = audit.getAll();
    const installEvents = events.filter(
      (e) => e.action === 'template_installed_from_marketplace',
    );
    expect(installEvents).toHaveLength(1);
    expect(installEvents[0]?.metadata).toMatchObject({
      templateId: 'investor-update-v1',
      version: '1.0.0',
    });

    // Tarball cleaned up at the temp path.
    expect(fs.binaryFiles.has('/ws/.lantern/templates/.tmp/investor-update-v1.tar.gz')).toBe(false);
  });

  it('emits onProgress callbacks for every phase', async () => {
    const fs = makeFs();
    const svc = buildService(fs);
    wireHappyPath(fs);

    const phases: Array<[string, number]> = [];
    await svc.install('investor-update-v1', {
      onProgress: (phase, pct) => phases.push([phase, pct]),
    });

    const phaseSet = new Set(phases.map((p) => p[0]));
    expect(phaseSet.has('download')).toBe(true);
    expect(phaseSet.has('checksum')).toBe(true);
    expect(phaseSet.has('extract')).toBe(true);
    expect(phaseSet.has('validate')).toBe(true);
    expect(phaseSet.has('audit')).toBe(true);
    // 0 and 100 ticks are emitted at phase boundaries.
    expect(phases).toContainEqual(['extract', 0]);
    expect(phases).toContainEqual(['extract', 100]);
    expect(phases).toContainEqual(['audit', 100]);
  });
});

describe('MarketplaceService.install (failure paths)', () => {
  it('audits template_install_failed and rolls back on checksum mismatch', async () => {
    const fs = makeFs();
    const audit = new AuditService(`test-${Math.random()}`);
    const svc = buildService(fs, audit);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => fakeStreamingResponse([new Uint8Array([9, 9, 9])])),
    );
    mockInvoke.mockReset();
    mockNativeCalls(async (cmd: string) => {
      if (cmd === 'sha256_file') return 'wronghash';
      throw new Error(`Unexpected invoke: ${cmd}`);
    });

    await expect(svc.install('investor-update-v1')).rejects.toThrow(/Checksum mismatch/);

    const events = audit.getAll().map((e) => e.action);
    expect(events).toContain('template_install_failed');
    expect(events).not.toContain('template_installed_from_marketplace');
    // Tarball + install dir both targeted by cleanup.
    expect(fs.spies.delete).toHaveBeenCalledWith(
      '/ws/.lantern/templates/.tmp/investor-update-v1.tar.gz',
    );
    expect(fs.spies.delete).toHaveBeenCalledWith(
      '/ws/.lantern/templates/investor-update-v1',
    );
    // No installed.json written.
    expect(fs.files.has('/ws/.lantern/templates/.installed.json')).toBe(false);
  });

  it('audits template_install_failed when the catalog entry is missing', async () => {
    const fs = makeFs();
    const audit = new AuditService(`test-${Math.random()}`);
    const svc = buildService(fs, audit);
    // Override cache to be empty.
    (svc as unknown as { cache: CatalogEntry[] }).cache = [];

    await expect(svc.install('does-not-exist')).rejects.toThrow(/not found in catalog/);
    const actions = audit.getAll().map((e) => e.action);
    expect(actions).toContain('template_install_failed');
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
    mockNativeCalls(async (cmd: string) => {
      if (cmd === 'sha256_file') return 'deadbeefcafef00d';
      if (cmd === 'extract_tarball') {
        // Write an obviously broken manifest (missing required `id`).
        fs.files.set(
          '/ws/.lantern/templates/investor-update-v1/manifest.json',
          JSON.stringify({ name: 'no id here' }),
        );
        return ['manifest.json'];
      }
      throw new Error(`Unexpected invoke: ${cmd}`);
    });

    await expect(svc.install('investor-update-v1')).rejects.toThrow(/Manifest invalid/);
    const actions = audit.getAll().map((e) => e.action);
    expect(actions).toContain('template_install_failed');
  });

  it('proceeds (with warning) when the catalog entry has no checksum', async () => {
    const fs = makeFs();
    const svc = buildService(fs);
    // Replace cache with a checksum-less entry.
    const entryNoChecksum: CatalogEntry = { ...SAMPLE_ENTRY };
    delete (entryNoChecksum as Partial<CatalogEntry>).checksum;
    (svc as unknown as { cache: CatalogEntry[] }).cache = [entryNoChecksum];

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => fakeStreamingResponse([new Uint8Array([1])])),
    );
    mockInvoke.mockReset();
    mockNativeCalls(async (cmd: string) => {
      if (cmd === 'extract_tarball') {
        fs.files.set(
          '/ws/.lantern/templates/investor-update-v1/manifest.json',
          JSON.stringify(SAMPLE_MANIFEST),
        );
        return ['manifest.json'];
      }
      throw new Error(`Unexpected invoke: ${cmd}`);
    });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const installed = await svc.install('investor-update-v1');
    expect(installed.id).toBe('investor-update-v1');
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('No checksum'));
    warnSpy.mockRestore();
  });
});

describe('MarketplaceService.uninstall', () => {
  it('removes install dir + index entry and audits', async () => {
    const fs = makeFs();
    const audit = new AuditService(`test-${Math.random()}`);
    const svc = buildService(fs, audit);
    wireHappyPath(fs);
    await svc.install('investor-update-v1');

    await svc.uninstall('investor-update-v1');

    expect(fs.spies.delete).toHaveBeenCalledWith(
      '/ws/.lantern/templates/investor-update-v1',
    );
    const indexRaw = fs.files.get('/ws/.lantern/templates/.installed.json')!;
    const index = JSON.parse(indexRaw);
    expect(index.entries).toHaveLength(0);
    const actions = audit.getAll().map((e) => e.action);
    expect(actions).toContain('template_uninstalled');
  });

  it('throws if the template is not installed', async () => {
    const fs = makeFs();
    const svc = buildService(fs);
    await expect(svc.uninstall('not-installed')).rejects.toThrow(/not installed/);
  });
});

describe('MarketplaceService.listInstalled', () => {
  it('returns [] when index file is missing', async () => {
    const fs = makeFs();
    const svc = buildService(fs);
    expect(await svc.listInstalled()).toEqual([]);
  });

  it('returns entries from a populated index', async () => {
    const fs = makeFs();
    const svc = buildService(fs);
    wireHappyPath(fs);
    await svc.install('investor-update-v1');
    const list = await svc.listInstalled();
    expect(list).toHaveLength(1);
    expect(list[0]?.id).toBe('investor-update-v1');
    expect(list[0]?.provenance).toBe('community');
  });
});

describe('MarketplaceService.install (concurrency)', () => {
  it('serializes concurrent install calls for the same id (returns same promise)', async () => {
    const fs = makeFs();
    const audit = new AuditService(`test-${Math.random()}`);
    const svc = buildService(fs, audit);
    wireHappyPath(fs);

    const [a, b] = await Promise.all([
      svc.install('investor-update-v1'),
      svc.install('investor-update-v1'),
    ]) as [InstalledEntry, InstalledEntry];

    expect(a.installedAt).toBe(b.installedAt);

    // Index should contain exactly one entry — proves the second call did not
    // re-execute the pipeline.
    const index = JSON.parse(fs.files.get('/ws/.lantern/templates/.installed.json')!);
    expect(index.entries).toHaveLength(1);

    // Audit must have exactly one success event.
    const successes = audit.getAll().filter(
      (e) => e.action === 'template_installed_from_marketplace',
    );
    expect(successes).toHaveLength(1);

    // After the install settles a third call resolves to a NEW entry (the
    // in-flight map was cleared).
    const c = await svc.install('investor-update-v1');
    expect(c.id).toBe('investor-update-v1');
  });

  it('clears the in-flight entry after a failure so retry is possible', async () => {
    const fs = makeFs();
    const svc = buildService(fs);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => fakeStreamingResponse([new Uint8Array([1])])),
    );
    mockInvoke.mockReset();
    mockNativeCalls(async (cmd: string) => {
      if (cmd === 'sha256_file') return 'wronghash';
      throw new Error(`Unexpected invoke: ${cmd}`);
    });
    await expect(svc.install('investor-update-v1')).rejects.toThrow(/Checksum/);

    // Now wire happy path and retry — should succeed.
    wireHappyPath(fs);
    const installed = await svc.install('investor-update-v1');
    expect(installed.id).toBe('investor-update-v1');
  });
});

describe('createTemplatesMarketplaceService factory', () => {
  it('binds the templates repo URL and workspace-derived paths', async () => {
    const fs = makeFs();
    const svc = createTemplatesMarketplaceService(fs.fs, '/ws');

    // Smoke-check the option wiring by inspecting refresh()'s URL.
    const fetchSpy = vi.fn(async () => ({
      ok: true,
      json: async () => [SAMPLE_ENTRY],
    } as Response));
    vi.stubGlobal('fetch', fetchSpy);
    await svc.refresh();
    expect(String(fetchSpy.mock.calls[0]?.[0])).toBe(`${TEMPLATES_REPO_URL}/catalog.json`);
    expect(fetchSpy.mock.calls[0]?.[1]).toMatchObject({
      redirect: 'manual',
      maxRedirections: 0,
    });

    // Cache path under workspace root.
    expect(fs.spies.write).toHaveBeenCalledWith(
      '/ws/.lantern/cache/templates.json',
      expect.any(String),
    );
  });

  it('strips a trailing slash on the workspace root', async () => {
    const fs = makeFs();
    const svc = createTemplatesMarketplaceService(fs.fs, '/ws/');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, json: async () => [] } as Response)),
    );
    await svc.refresh();
    expect(fs.spies.write).toHaveBeenCalledWith(
      '/ws/.lantern/cache/templates.json',
      expect.any(String),
    );
  });

  it('stamps installed entries with provenance "community"', async () => {
    const fs = makeFs();
    const svc = createTemplatesMarketplaceService(fs.fs, '/ws');
    (svc as unknown as { cache: CatalogEntry[] }).cache = [SAMPLE_ENTRY];
    wireHappyPath(fs);
    // Re-route extract output to the factory's installRoot.
    mockInvoke.mockReset();
    mockNativeCalls(async (cmd: string) => {
      if (cmd === 'sha256_file') return 'deadbeefcafef00d';
      if (cmd === 'extract_tarball') {
        fs.files.set(
          '/ws/.lantern/templates/investor-update-v1/manifest.json',
          JSON.stringify(SAMPLE_MANIFEST),
        );
        return ['manifest.json'];
      }
      throw new Error(`Unexpected invoke: ${cmd}`);
    });
    const installed = await svc.install('investor-update-v1');
    expect(installed.provenance).toBe('community');
  });
});

// ---------------------------------------------------------------------------
// Group VIII: checkForUpdates + isUpdate audit shape
// ---------------------------------------------------------------------------

/**
 * Build a service with the catalog presented as freshly fetched (so
 * checkForUpdates does not try to re-fetch over the network) and install a
 * known template at the supplied installed version.
 *
 * Returns an `installEntry` helper that lets each test seed `installed.json`
 * with its own catalog/installed version pair without re-running the install
 * pipeline.
 */
function buildServiceWithFreshCache(
  fs: FakeFs,
  catalog: CatalogEntry[],
  audit?: AuditService,
): MarketplaceService {
  const svc = new MarketplaceService({
    repoUrl: 'https://raw.githubusercontent.com/test/community-templates/main',
    catalogPath: 'catalog.json',
    cachePath: '/ws/.lantern/cache/templates.json',
    installRoot: '/ws/.lantern/templates',
    fs: fs.fs,
    provenance: 'community',
    ...(audit ? { auditService: audit } : {}),
  });
  // Pre-seed the in-memory catalog AND mark the last fetch as fresh so
  // checkForUpdates() short-circuits the silent refresh.
  const internal = svc as unknown as {
    cache: CatalogEntry[];
    lastFetchedAt: string | null;
    lastFetchFailed: boolean;
  };
  internal.cache = catalog;
  internal.lastFetchedAt = new Date().toISOString();
  internal.lastFetchFailed = false;
  return svc;
}

function seedInstalled(fs: FakeFs, entries: InstalledEntry[]): void {
  fs.files.set(
    '/ws/.lantern/templates/.installed.json',
    JSON.stringify({ entries }, null, 2),
  );
}

function makeInstalledEntry(id: string, version: string, overrides: Partial<CatalogEntry> = {}): InstalledEntry {
  const entry: CatalogEntry = {
    id,
    name: id,
    description: `${id} description`,
    version,
    author: { name: 'Test' },
    category: 'misc',
    tags: [],
    installUrl: `https://raw.githubusercontent.com/test/community-templates/main/${id}.tar.gz`,
    manifestUrl: `https://raw.githubusercontent.com/test/community-templates/main/${id}.json`,
    minAppVersion: '2.0.0',
    publishedAt: '2026-04-28T00:00:00.000Z',
    updatedAt: '2026-04-28T00:00:00.000Z',
    ...overrides,
  };
  return {
    ...entry,
    installedAt: '2026-04-28T00:00:00.000Z',
    installedPath: `/ws/.lantern/templates/${id}`,
    provenance: 'community',
    manifestVersion: '1.0',
  };
}

describe('MarketplaceService.checkForUpdates', () => {
  it('returns [] when no updates are available (catalog matches installed)', async () => {
    const fs = makeFs();
    const svc = buildServiceWithFreshCache(fs, [
      { ...SAMPLE_ENTRY, id: 'a', version: '1.0.0' },
      { ...SAMPLE_ENTRY, id: 'b', version: '2.5.0' },
    ]);
    seedInstalled(fs, [
      makeInstalledEntry('a', '1.0.0'),
      makeInstalledEntry('b', '2.5.0'),
    ]);

    const updates = await svc.checkForUpdates();
    expect(updates).toEqual([]);
  });

  it('returns one entry when a single installed template has a newer catalog version', async () => {
    const fs = makeFs();
    const svc = buildServiceWithFreshCache(fs, [
      { ...SAMPLE_ENTRY, id: 'a', version: '1.2.0' },
    ]);
    seedInstalled(fs, [makeInstalledEntry('a', '1.0.0')]);

    const updates = await svc.checkForUpdates();
    expect(updates).toEqual([
      { id: 'a', installedVersion: '1.0.0', latestVersion: '1.2.0' },
    ]);
  });

  it('returns multiple entries when multiple installed templates have newer versions', async () => {
    const fs = makeFs();
    const svc = buildServiceWithFreshCache(fs, [
      { ...SAMPLE_ENTRY, id: 'a', version: '1.2.0' },
      { ...SAMPLE_ENTRY, id: 'b', version: '3.0.0' },
      { ...SAMPLE_ENTRY, id: 'c', version: '0.9.0' },
    ]);
    seedInstalled(fs, [
      makeInstalledEntry('a', '1.0.0'),
      makeInstalledEntry('b', '2.0.0'),
      // c is not installed; a + b should be reported
    ]);

    const updates = await svc.checkForUpdates();
    expect(updates).toHaveLength(2);
    expect(updates.find((u) => u.id === 'a')).toEqual({
      id: 'a',
      installedVersion: '1.0.0',
      latestVersion: '1.2.0',
    });
    expect(updates.find((u) => u.id === 'b')).toEqual({
      id: 'b',
      installedVersion: '2.0.0',
      latestVersion: '3.0.0',
    });
  });

  it('ignores downgrades (catalog version older than installed)', async () => {
    const fs = makeFs();
    const svc = buildServiceWithFreshCache(fs, [
      { ...SAMPLE_ENTRY, id: 'a', version: '1.0.0' },
    ]);
    seedInstalled(fs, [makeInstalledEntry('a', '2.5.0')]);

    const updates = await svc.checkForUpdates();
    expect(updates).toEqual([]);
  });

  it('ignores installed ids that no longer exist in the catalog', async () => {
    const fs = makeFs();
    const svc = buildServiceWithFreshCache(fs, [
      { ...SAMPLE_ENTRY, id: 'b', version: '2.0.0' },
    ]);
    seedInstalled(fs, [
      makeInstalledEntry('orphaned', '1.0.0'),
      makeInstalledEntry('b', '1.0.0'),
    ]);

    const updates = await svc.checkForUpdates();
    expect(updates).toEqual([
      { id: 'b', installedVersion: '1.0.0', latestVersion: '2.0.0' },
    ]);
  });

  it('refreshes silently when the cache is stale', async () => {
    const fs = makeFs();
    const svc = new MarketplaceService({
      repoUrl: 'https://raw.githubusercontent.com/test/community-templates/main',
      catalogPath: 'catalog.json',
      cachePath: '/ws/.lantern/cache/templates.json',
      installRoot: '/ws/.lantern/templates',
      fs: fs.fs,
      provenance: 'community',
    });
    // Mark cache as stale: lastFetchedAt is far in the past.
    const internal = svc as unknown as {
      cache: CatalogEntry[];
      lastFetchedAt: string | null;
    };
    internal.cache = [{ ...SAMPLE_ENTRY, id: 'a', version: '1.0.0' }];
    internal.lastFetchedAt = new Date(Date.now() - 1000 * 60 * 60 * 24 * 30).toISOString();
    seedInstalled(fs, [makeInstalledEntry('a', '1.0.0')]);

    const fetchSpy = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => [{ ...SAMPLE_ENTRY, id: 'a', version: '2.0.0' }],
    } as unknown as Response));
    vi.stubGlobal('fetch', fetchSpy);

    const updates = await svc.checkForUpdates();
    // Refresh was triggered (and produced a newer version) so the update is
    // reported.
    expect(fetchSpy).toHaveBeenCalled();
    expect(updates).toEqual([
      { id: 'a', installedVersion: '1.0.0', latestVersion: '2.0.0' },
    ]);
  });

  it('does not throw when refresh fails offline (returns based on cached catalog)', async () => {
    const fs = makeFs();
    const svc = new MarketplaceService({
      repoUrl: 'https://raw.githubusercontent.com/test/community-templates/main',
      catalogPath: 'catalog.json',
      cachePath: '/ws/.lantern/cache/templates.json',
      installRoot: '/ws/.lantern/templates',
      fs: fs.fs,
      provenance: 'community',
    });
    // No prior fetch + cached catalog already in memory.
    const internal = svc as unknown as { cache: CatalogEntry[] };
    internal.cache = [{ ...SAMPLE_ENTRY, id: 'a', version: '1.5.0' }];
    seedInstalled(fs, [makeInstalledEntry('a', '1.0.0')]);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('offline');
      }),
    );

    const updates = await svc.checkForUpdates();
    expect(updates).toEqual([
      { id: 'a', installedVersion: '1.0.0', latestVersion: '1.5.0' },
    ]);
  });

  it('returns [] when nothing is installed', async () => {
    const fs = makeFs();
    const svc = buildServiceWithFreshCache(fs, [SAMPLE_ENTRY]);
    const updates = await svc.checkForUpdates();
    expect(updates).toEqual([]);
  });
});

describe('MarketplaceService.install — update audit shape', () => {
  it('emits template_updated (not template_installed_from_marketplace) when isUpdate=true', async () => {
    const fs = makeFs();
    const audit = new AuditService(`test-${Math.random()}`);
    const svc = buildService(fs, audit);
    wireHappyPath(fs);

    await svc.install('investor-update-v1', {
      isUpdate: true,
      fromVersion: '0.9.0',
    });

    const events = audit.getAll();
    const updated = events.filter((e) => e.action === 'template_updated');
    const installed = events.filter(
      (e) => e.action === 'template_installed_from_marketplace',
    );
    expect(updated).toHaveLength(1);
    expect(installed).toHaveLength(0);
    expect(updated[0]?.metadata).toMatchObject({
      templateId: 'investor-update-v1',
      fromVersion: '0.9.0',
      toVersion: '1.0.0',
      version: '1.0.0',
    });
  });

  it('falls back to fromVersion="unknown" when caller forgets to pass it', async () => {
    const fs = makeFs();
    const audit = new AuditService(`test-${Math.random()}`);
    const svc = buildService(fs, audit);
    wireHappyPath(fs);

    await svc.install('investor-update-v1', { isUpdate: true });
    const updated = audit
      .getAll()
      .filter((e) => e.action === 'template_updated');
    expect(updated).toHaveLength(1);
    expect(updated[0]?.metadata).toMatchObject({
      fromVersion: 'unknown',
      toVersion: '1.0.0',
    });
  });

  it('still emits the install audit event when isUpdate is omitted', async () => {
    const fs = makeFs();
    const audit = new AuditService(`test-${Math.random()}`);
    const svc = buildService(fs, audit);
    wireHappyPath(fs);
    await svc.install('investor-update-v1');
    const installed = audit
      .getAll()
      .filter((e) => e.action === 'template_installed_from_marketplace');
    const updated = audit.getAll().filter((e) => e.action === 'template_updated');
    expect(installed).toHaveLength(1);
    expect(updated).toHaveLength(0);
  });
});
