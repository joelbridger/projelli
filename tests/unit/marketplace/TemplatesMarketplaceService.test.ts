import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock Tauri invoke BEFORE importing the service so its transitive
// `install.ts` import binds to the mock.
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

import * as tauriCore from '@tauri-apps/api/core';
import { MarketplaceService } from '@/modules/marketplace/MarketplaceService';
import {
  createTemplatesMarketplaceService,
  TEMPLATES_REPO_URL,
} from '@/modules/marketplace/TemplatesMarketplaceService';
import { AuditService } from '@/modules/audit/AuditService';
import type { FSBackend } from '@/modules/workspace/types';
import type { CatalogEntry, InstalledEntry } from '@/types/marketplace';
import type { TemplateManifest } from '@/types/templateManifest';

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

const SAMPLE_ENTRY: CatalogEntry = {
  id: 'investor-update-v1',
  name: 'Monthly Investor Update',
  description: 'Monthly update template for early-stage investors',
  version: '1.0.0',
  author: { name: 'Jameson Daines', githubUser: 'jamesondaines' },
  category: 'investor',
  tags: ['investor', 'update', 'monthly'],
  installUrl: 'https://example.test/investor.tar.gz',
  manifestUrl: 'https://example.test/manifest.json',
  minProjelliVersion: '2.0.0',
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
  minProjelliVersion: '2.0.0',
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
    repoUrl: 'https://example.test',
    catalogPath: 'catalog.json',
    cachePath: '/ws/.projelli/cache/templates.json',
    installRoot: '/ws/.projelli/templates',
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
  mockInvoke.mockImplementation(async (cmd: string) => {
    if (cmd === 'sha256_file') return 'deadbeefcafef00d';
    if (cmd === 'extract_tarball') {
      // Simulate the Rust extractor placing manifest.json on disk.
      fs.files.set(
        '/ws/.projelli/templates/investor-update-v1/manifest.json',
        JSON.stringify(SAMPLE_MANIFEST),
      );
      return ['manifest.json', 'template.md', 'questions.json', 'workflow.json'];
    }
    throw new Error(`Unexpected invoke: ${cmd}`);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
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
    expect(installed.installedPath).toBe('/ws/.projelli/templates/investor-update-v1');
    expect(installed.installedAt).toBeDefined();

    // installed.json index was written.
    expect(fs.files.has('/ws/.projelli/templates/.installed.json')).toBe(true);
    const indexRaw = fs.files.get('/ws/.projelli/templates/.installed.json')!;
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
    expect(fs.binaryFiles.has('/ws/.projelli/templates/.tmp/investor-update-v1.tar.gz')).toBe(false);
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
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'sha256_file') return 'wronghash';
      throw new Error(`Unexpected invoke: ${cmd}`);
    });

    await expect(svc.install('investor-update-v1')).rejects.toThrow(/Checksum mismatch/);

    const events = audit.getAll().map((e) => e.action);
    expect(events).toContain('template_install_failed');
    expect(events).not.toContain('template_installed_from_marketplace');
    // Tarball + install dir both targeted by cleanup.
    expect(fs.spies.delete).toHaveBeenCalledWith(
      '/ws/.projelli/templates/.tmp/investor-update-v1.tar.gz',
    );
    expect(fs.spies.delete).toHaveBeenCalledWith(
      '/ws/.projelli/templates/investor-update-v1',
    );
    // No installed.json written.
    expect(fs.files.has('/ws/.projelli/templates/.installed.json')).toBe(false);
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
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'sha256_file') return 'deadbeefcafef00d';
      if (cmd === 'extract_tarball') {
        // Write an obviously broken manifest (missing required `id`).
        fs.files.set(
          '/ws/.projelli/templates/investor-update-v1/manifest.json',
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
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'extract_tarball') {
        fs.files.set(
          '/ws/.projelli/templates/investor-update-v1/manifest.json',
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
      '/ws/.projelli/templates/investor-update-v1',
    );
    const indexRaw = fs.files.get('/ws/.projelli/templates/.installed.json')!;
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
    const index = JSON.parse(fs.files.get('/ws/.projelli/templates/.installed.json')!);
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
    mockInvoke.mockImplementationOnce(async () => 'wronghash');
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
    expect(fetchSpy).toHaveBeenCalledWith(`${TEMPLATES_REPO_URL}/catalog.json`);

    // Cache path under workspace root.
    expect(fs.spies.write).toHaveBeenCalledWith(
      '/ws/.projelli/cache/templates.json',
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
      '/ws/.projelli/cache/templates.json',
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
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'sha256_file') return 'deadbeefcafef00d';
      if (cmd === 'extract_tarball') {
        fs.files.set(
          '/ws/.projelli/templates/investor-update-v1/manifest.json',
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
