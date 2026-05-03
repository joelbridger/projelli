import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MarketplaceService } from '@/modules/marketplace/MarketplaceService';
import type { FSBackend } from '@/modules/workspace/types';
import type { CatalogEntry } from '@/types/marketplace';

function makeFs() {
  const writes = new Map<string, Uint8Array>();
  return {
    writes,
    read: vi.fn(async (p) => new TextDecoder().decode(writes.get(p) ?? new Uint8Array())),
    write: vi.fn(async (p, c) => writes.set(p, new TextEncoder().encode(c))),
    readBinary: vi.fn(async (p) => (writes.get(p) ?? new Uint8Array()).buffer),
    writeBinary: vi.fn(async (p, b) => writes.set(p, new Uint8Array(b))),
    delete: vi.fn(async (p) => writes.delete(p)),
    exists: vi.fn(async (p) => writes.has(p)),
    move: vi.fn(),
    list: vi.fn(),
    mkdir: vi.fn(async () => {}),
  } as unknown as FSBackend;
}

const SAMPLE: CatalogEntry[] = [
  {
    id: 'a', name: 'A', description: '', version: '1.0.0',
    author: { name: 'x' }, category: 'misc', tags: [],
    installUrl: 'http://e/a.tar.gz', manifestUrl: 'http://e/manifest.json',
    minProjelliVersion: '2.0.0', publishedAt: '2026-04-28', updatedAt: '2026-04-28',
  },
];

describe('MarketplaceService.refresh', () => {
  let fs: ReturnType<typeof makeFs>;
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fs = makeFs();
    fetchSpy = vi.fn(async () => ({
      ok: true,
      json: async () => SAMPLE,
    } as Response));
    vi.stubGlobal('fetch', fetchSpy);
  });

  it('fetches catalog from repo and writes cache', async () => {
    const svc = new MarketplaceService({
      repoUrl: 'https://raw.githubusercontent.com/projelli/community-templates/main',
      catalogPath: 'catalog.json',
      cachePath: '.projelli/cache/marketplace-templates.json',
      installRoot: '.projelli/templates',
      fs,
    });
    await svc.refresh();
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://raw.githubusercontent.com/projelli/community-templates/main/catalog.json'
    );
    const cached = await svc.list();
    expect(cached).toHaveLength(1);
    expect(cached[0].id).toBe('a');
  });

  it('uses cached catalog when fetch fails', async () => {
    const svc = new MarketplaceService({
      repoUrl: 'http://e',
      catalogPath: 'catalog.json',
      cachePath: '.projelli/cache/m.json',
      installRoot: '.projelli/templates',
      fs,
    });
    await svc.refresh();
    fetchSpy.mockRejectedValueOnce(new Error('offline'));
    await svc.refresh({ silent: true });
    const list = await svc.list();
    expect(list).toHaveLength(1);
  });
});

describe('MarketplaceService.getById', () => {
  let fs: ReturnType<typeof makeFs>;
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fs = makeFs();
    fetchSpy = vi.fn(async () => ({ ok: true, json: async () => SAMPLE } as Response));
    vi.stubGlobal('fetch', fetchSpy);
  });

  it('returns entry by id', async () => {
    const svc = new MarketplaceService({
      repoUrl: 'http://e', catalogPath: 'catalog.json',
      cachePath: '.cache.json', installRoot: '.r', fs,
    });
    await svc.refresh();
    const e = await svc.getById('a');
    expect(e?.name).toBe('A');
  });

  it('returns null for unknown id', async () => {
    const svc = new MarketplaceService({
      repoUrl: 'http://e', catalogPath: 'catalog.json',
      cachePath: '.cache.json', installRoot: '.r', fs,
    });
    await svc.refresh();
    expect(await svc.getById('nonexistent')).toBeNull();
  });
});

describe('MarketplaceService.cacheStatus', () => {
  let fs: ReturnType<typeof makeFs>;
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fs = makeFs();
    fetchSpy = vi.fn(async () => ({ ok: true, json: async () => SAMPLE } as Response));
    vi.stubGlobal('fetch', fetchSpy);
  });

  it('reports offline before any refresh', () => {
    const svc = new MarketplaceService({
      repoUrl: 'http://e', catalogPath: 'c.json',
      cachePath: '.cache.json', installRoot: '.r', fs,
    });
    expect(svc.cacheStatus()).toBe('offline');
  });

  it('reports fresh immediately after a successful refresh', async () => {
    const svc = new MarketplaceService({
      repoUrl: 'http://e', catalogPath: 'c.json',
      cachePath: '.cache.json', installRoot: '.r', fs,
    });
    await svc.refresh();
    expect(svc.cacheStatus()).toBe('fresh');
  });

  it('reports stale when the last successful fetch is older than cacheTtlMs', async () => {
    const svc = new MarketplaceService({
      repoUrl: 'http://e', catalogPath: 'c.json',
      cachePath: '.cache.json', installRoot: '.r', fs,
      cacheTtlMs: 1, // make any past fetch instantly stale
    });
    await svc.refresh();
    // Wait long enough for cacheTtlMs (1ms) to elapse.
    await new Promise((r) => setTimeout(r, 5));
    expect(svc.cacheStatus()).toBe('stale');
  });

  it('reports offline after a silent refresh failure with no prior cache', async () => {
    fetchSpy.mockRejectedValue(new Error('boom'));
    const svc = new MarketplaceService({
      repoUrl: 'http://e', catalogPath: 'c.json',
      cachePath: '.cache.json', installRoot: '.r', fs,
    });
    await svc.refresh({ silent: true });
    expect(svc.cacheStatus()).toBe('offline');
  });

  it('reports offline after a fetch failure even when a prior cache exists', async () => {
    const svc = new MarketplaceService({
      repoUrl: 'http://e', catalogPath: 'c.json',
      cachePath: '.cache.json', installRoot: '.r', fs,
    });
    await svc.refresh();
    fetchSpy.mockRejectedValueOnce(new Error('boom'));
    await svc.refresh({ silent: true });
    expect(svc.cacheStatus()).toBe('offline');
  });
});

describe('MarketplaceService default behavior (Group III pre-conditions)', () => {
  let fs: ReturnType<typeof makeFs>;

  beforeEach(() => {
    fs = makeFs();
  });

  it('install throws when the catalog has not been refreshed', async () => {
    const svc = new MarketplaceService({
      repoUrl: 'http://e', catalogPath: 'c.json',
      cachePath: '.cache.json', installRoot: '.r', fs,
    });
    await expect(svc.install('x')).rejects.toThrow(/not found in catalog/);
  });

  it('uninstall throws when nothing is installed', async () => {
    const svc = new MarketplaceService({
      repoUrl: 'http://e', catalogPath: 'c.json',
      cachePath: '.cache.json', installRoot: '.r', fs,
    });
    await expect(svc.uninstall('x')).rejects.toThrow(/not installed/);
  });

  it('listInstalled returns empty array when index file is missing', async () => {
    const svc = new MarketplaceService({
      repoUrl: 'http://e', catalogPath: 'c.json',
      cachePath: '.cache.json', installRoot: '.r', fs,
    });
    expect(await svc.listInstalled()).toEqual([]);
  });

  it('checkForUpdates returns empty array', async () => {
    const svc = new MarketplaceService({
      repoUrl: 'http://e', catalogPath: 'c.json',
      cachePath: '.cache.json', installRoot: '.r', fs,
    });
    expect(await svc.checkForUpdates()).toEqual([]);
  });
});

describe('MarketplaceService.readInstalledManifest', () => {
  it('returns null when the template is not installed', async () => {
    const fs = makeFs();
    const svc = new MarketplaceService({
      repoUrl: 'http://e', catalogPath: 'c.json',
      cachePath: '.cache.json', installRoot: '/r', fs,
    });
    expect(await svc.readInstalledManifest('missing')).toBeNull();
  });

  it('returns the parsed manifest when it exists and validates', async () => {
    const fs = makeFs();
    const svc = new MarketplaceService({
      repoUrl: 'http://e', catalogPath: 'c.json',
      cachePath: '.cache.json', installRoot: '/r', fs,
    });
    // Seed installed.json + manifest.json on disk.
    await fs.write(
      '/r/.installed.json',
      JSON.stringify({
        entries: [
          {
            id: 'x', name: 'X', description: 'd', version: '1.0.0',
            author: { name: 'a' }, category: 'misc', tags: [],
            installUrl: 'http://e/x.tar.gz', manifestUrl: 'http://e/m.json',
            minProjelliVersion: '2.0.0', publishedAt: '2026-04-28', updatedAt: '2026-04-28',
            installedAt: '2026-04-28T00:00:00Z',
            installedPath: '/r/x',
            provenance: 'community',
            manifestVersion: '1.0',
          },
        ],
      }),
    );
    await fs.write(
      '/r/x/manifest.json',
      JSON.stringify({
        apiVersion: '1.0',
        id: 'x',
        name: 'X',
        description: 'd',
        version: '1.0.0',
        author: { name: 'a' },
        category: 'misc',
        tags: [],
        files: [{ path: 'workflow.json', type: 'workflow-definition' }],
        minProjelliVersion: '2.0.0',
      }),
    );

    const m = await svc.readInstalledManifest('x');
    expect(m).not.toBeNull();
    expect(m?.id).toBe('x');
    expect(m?.files.length).toBe(1);
  });

  it('returns null when the manifest file is missing or invalid', async () => {
    const fs = makeFs();
    const svc = new MarketplaceService({
      repoUrl: 'http://e', catalogPath: 'c.json',
      cachePath: '.cache.json', installRoot: '/r', fs,
    });
    await fs.write(
      '/r/.installed.json',
      JSON.stringify({
        entries: [
          {
            id: 'x', name: 'X', description: 'd', version: '1.0.0',
            author: { name: 'a' }, category: 'misc', tags: [],
            installUrl: 'http://e/x.tar.gz', manifestUrl: 'http://e/m.json',
            minProjelliVersion: '2.0.0', publishedAt: '2026-04-28', updatedAt: '2026-04-28',
            installedAt: '2026-04-28T00:00:00Z',
            installedPath: '/r/x',
            provenance: 'community',
            manifestVersion: '1.0',
          },
        ],
      }),
    );
    // No manifest.json on disk -> read returns empty, JSON.parse fails, returns null.
    expect(await svc.readInstalledManifest('x')).toBeNull();
  });
});
