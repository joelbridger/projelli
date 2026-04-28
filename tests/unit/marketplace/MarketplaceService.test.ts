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
