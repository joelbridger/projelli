import type { FSBackend } from '@/modules/workspace/types';
import type { CatalogEntry, InstalledEntry, UpdateInfo } from '@/types/marketplace';

interface MarketplaceServiceOptions {
  repoUrl: string;
  catalogPath: string;
  cachePath: string;
  installRoot: string;
  fs: FSBackend;
  cacheTtlMs?: number;
}

interface CacheFile {
  fetchedAt: string;
  entries: CatalogEntry[];
}

export class MarketplaceService {
  private cache: CatalogEntry[] | null = null;

  constructor(private opts: MarketplaceServiceOptions) {}

  async refresh(opts?: { silent?: boolean }): Promise<void> {
    const url = `${this.opts.repoUrl}/${this.opts.catalogPath}`;
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const entries = (await res.json()) as CatalogEntry[];
      this.cache = entries;
      const cacheFile: CacheFile = { fetchedAt: new Date().toISOString(), entries };
      await this.opts.fs.write(this.opts.cachePath, JSON.stringify(cacheFile));
    } catch (err) {
      if (!opts?.silent) throw err;
      await this.loadCachedIfPresent();
    }
  }

  private async loadCachedIfPresent(): Promise<void> {
    try {
      const raw = await this.opts.fs.read(this.opts.cachePath);
      const parsed = JSON.parse(raw) as CacheFile;
      this.cache = parsed.entries;
    } catch {
      // no cache yet
    }
  }

  async list(): Promise<CatalogEntry[]> {
    if (this.cache === null) await this.loadCachedIfPresent();
    return this.cache ?? [];
  }

  async getById(id: string): Promise<CatalogEntry | null> {
    const list = await this.list();
    return list.find((e) => e.id === id) ?? null;
  }

  async install(id: string, _opts?: { onProgress?: (frac: number) => void }): Promise<InstalledEntry> {
    void id;
    throw new Error('install not implemented in foundations (Stream C scope)');
  }

  async uninstall(id: string): Promise<void> {
    void id;
    throw new Error('uninstall not implemented in foundations (Stream C scope)');
  }

  async listInstalled(): Promise<InstalledEntry[]> {
    return [];
  }

  async checkForUpdates(): Promise<UpdateInfo[]> {
    return [];
  }
}
