import type { FSBackend } from '@/modules/workspace/types';
import type { CatalogEntry, InstalledEntry, UpdateInfo, TemplateProvenance } from '@/types/marketplace';
import { AuditService } from '@/modules/audit/AuditService';
import {
  downloadTarball,
  verifyChecksum,
  extractTarball,
  cleanupOnError,
  type DownloadProgress,
} from './install';
import { validateTemplateManifest } from './manifestValidator';

export interface MarketplaceServiceOptions {
  repoUrl: string;
  catalogPath: string;
  cachePath: string;
  installRoot: string;
  fs: FSBackend;
  cacheTtlMs?: number;
  /** Provenance stamped on installed entries. Defaults to 'community'. */
  provenance?: TemplateProvenance;
  /** AuditService instance; one is constructed per-service if not supplied. */
  auditService?: AuditService;
}

export type InstallPhase = 'download' | 'checksum' | 'extract' | 'validate' | 'audit';

export interface InstallOptions {
  onProgress?: (phase: InstallPhase, pct: number) => void;
  signal?: AbortSignal;
}

interface CacheFile {
  fetchedAt: string;
  entries: CatalogEntry[];
}

interface InstalledIndex {
  entries: InstalledEntry[];
}

export class MarketplaceService {
  private cache: CatalogEntry[] | null = null;
  private installedCache: InstalledEntry[] | null = null;
  private readonly auditService: AuditService;
  private readonly defaultProvenance: TemplateProvenance;
  /**
   * In-flight installs keyed by template id. A second `install(sameId)` call
   * returns the same promise rather than starting a duplicate pipeline; this
   * keeps the FS, audit log, and installed index consistent under concurrent
   * UI clicks.
   */
  private inFlight = new Map<string, Promise<InstalledEntry>>();

  constructor(private opts: MarketplaceServiceOptions) {
    this.auditService = opts.auditService ?? new AuditService('marketplace');
    this.defaultProvenance = opts.provenance ?? 'community';
  }

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

  /**
   * Install a template by id. Composes the install primitives:
   *   1. resolve catalog entry
   *   2. download tarball to a temp path
   *   3. verify SHA-256 (warn if absent on the catalog entry)
   *   4. extract to installRoot/<id>
   *   5. read+validate the extracted manifest.json
   *   6. update installed.json index
   *   7. emit audit event
   *
   * On any failure, runs cleanupOnError against the temp tarball + install
   * dir, audits `template_install_failed`, and re-throws.
   */
  async install(id: string, opts: InstallOptions = {}): Promise<InstalledEntry> {
    const existing = this.inFlight.get(id);
    if (existing) return existing;
    const promise = this.doInstall(id, opts).finally(() => {
      this.inFlight.delete(id);
    });
    this.inFlight.set(id, promise);
    return promise;
  }

  private async doInstall(id: string, opts: InstallOptions): Promise<InstalledEntry> {
    const { onProgress } = opts;
    const tmpPath = `${this.opts.installRoot}/.tmp/${id}.tar.gz`;
    const installDir = `${this.opts.installRoot}/${id}`;
    let entry: CatalogEntry | null = null;

    try {
      entry = await this.getById(id);
      if (!entry) {
        throw new Error(`Template not found in catalog: ${id}`);
      }

      // 1. Download
      onProgress?.('download', 0);
      const downloadOpts: { onProgress: (p: DownloadProgress) => void; signal?: AbortSignal } = {
        onProgress: (p: DownloadProgress) => {
          if (p.fraction !== null) {
            onProgress?.('download', Math.min(99, Math.round(p.fraction * 100)));
          } else if (p.total === null) {
            // Unknown total: emit a coarse heartbeat at 50% so the UI doesn't
            // appear stuck during long downloads.
            onProgress?.('download', 50);
          }
        },
      };
      if (opts.signal) downloadOpts.signal = opts.signal;
      await downloadTarball(entry.installUrl, tmpPath, this.opts.fs, downloadOpts);
      onProgress?.('download', 100);

      // 2. Verify checksum (warn on missing, throw on mismatch).
      onProgress?.('checksum', 0);
      if (entry.checksum) {
        const ok = await verifyChecksum(tmpPath, entry.checksum);
        if (!ok) {
          throw new Error(
            `Checksum mismatch for ${id}: tarball does not match expected SHA-256`,
          );
        }
      } else {
        // eslint-disable-next-line no-console
        console.warn(
          `[marketplace] No checksum on catalog entry for ${id}; install proceeding without verification.`,
        );
      }
      onProgress?.('checksum', 100);

      // 3. Extract
      onProgress?.('extract', 0);
      await extractTarball(tmpPath, installDir);
      onProgress?.('extract', 100);

      // 4. Validate manifest
      onProgress?.('validate', 0);
      const manifestPath = `${installDir}/manifest.json`;
      const rawManifest = await this.opts.fs.read(manifestPath);
      const parsed = JSON.parse(rawManifest);
      const result = validateTemplateManifest(parsed);
      if (!result.ok) {
        throw new Error(`Manifest invalid: ${result.errors.join('; ')}`);
      }
      const manifest = result.manifest;
      onProgress?.('validate', 100);

      // 5. Persist installed.json index
      const installed: InstalledEntry = {
        ...entry,
        installedAt: new Date().toISOString(),
        installedPath: installDir,
        provenance: this.defaultProvenance,
        manifestVersion: manifest.apiVersion,
      };
      const index = await this.readInstalledIndex();
      const next = index.filter((e) => e.id !== id);
      next.push(installed);
      await this.writeInstalledIndex(next);

      // 6. Audit
      onProgress?.('audit', 0);
      this.auditService.append({
        type: 'template_installed_from_marketplace',
        timestamp: new Date().toISOString(),
        payload: { templateId: id, version: entry.version },
      });
      onProgress?.('audit', 100);

      // 7. Cleanup tarball (best effort)
      await cleanupOnError(this.opts.fs, [tmpPath]);

      return installed;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await cleanupOnError(this.opts.fs, [tmpPath, installDir]);
      this.auditService.append({
        type: 'template_install_failed',
        timestamp: new Date().toISOString(),
        payload: {
          templateId: id,
          version: entry?.version ?? 'unknown',
          error: message,
        },
      });
      throw err;
    }
  }

  async uninstall(id: string): Promise<void> {
    const index = await this.readInstalledIndex();
    const target = index.find((e) => e.id === id);
    if (!target) {
      throw new Error(`Template not installed: ${id}`);
    }
    await cleanupOnError(this.opts.fs, [target.installedPath]);
    const next = index.filter((e) => e.id !== id);
    await this.writeInstalledIndex(next);
    this.auditService.append({
      type: 'template_uninstalled',
      timestamp: new Date().toISOString(),
      payload: { templateId: id, version: target.version },
    });
  }

  async listInstalled(): Promise<InstalledEntry[]> {
    return this.readInstalledIndex();
  }

  async checkForUpdates(): Promise<UpdateInfo[]> {
    return [];
  }

  // ---- installed.json helpers ----------------------------------------------

  private installedIndexPath(): string {
    return `${this.opts.installRoot}/.installed.json`;
  }

  private async readInstalledIndex(): Promise<InstalledEntry[]> {
    if (this.installedCache) return this.installedCache;
    try {
      const raw = await this.opts.fs.read(this.installedIndexPath());
      const parsed = JSON.parse(raw) as InstalledIndex;
      this.installedCache = parsed.entries ?? [];
    } catch {
      this.installedCache = [];
    }
    return this.installedCache;
  }

  private async writeInstalledIndex(entries: InstalledEntry[]): Promise<void> {
    this.installedCache = entries;
    const payload: InstalledIndex = { entries };
    await this.opts.fs.write(this.installedIndexPath(), JSON.stringify(payload, null, 2));
  }
}
