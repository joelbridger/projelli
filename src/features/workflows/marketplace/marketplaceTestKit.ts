// marketplaceTestKit.ts — E2E test seam for the Templates Marketplace.
//
// F3.7b (2026-07-03): templates-marketplace.spec.ts used to reach the real
// MarketplaceService/TemplateMetadataReader classes via
// `import('/src/features/workflows/marketplace/svc/index.ts')` from the page
// context, relying on Vite's dev-server module graph serving raw TS source
// over HTTP. That route only exists under `vite dev` — CI's preview server
// serves a production `vite build` (hashed `dist/assets/*.js`), so the
// dynamic import 404s there. This module replaces that dev-only trick with a
// real product-code seam: a statically-imported module that builds the same
// test doubles from the ACTUAL classes and exposes them on
// `window.__marketplaceTestKit`, mirroring the existing
// `window.__templatesMarketplaceStore` seam (useTestModeWorkspace.ts).
//
// Side-effect import only — importing this module (from MarketplaceTab.tsx)
// is what installs the seam. Gated on the same `?testMode=true` signal the
// rest of the E2E harness uses, so it is a no-op in a real user's build.

import { MarketplaceService, type MarketplaceServiceOptions } from './svc/MarketplaceService';
import { TemplateMetadataReader } from './svc/TemplateMetadataReader';
import type { FSBackend } from '@/platform/fs/types';
import type { CatalogEntry, InstalledEntry } from '@/features/workflows/types/marketplace';

export interface MarketplaceTestKit {
  buildService: (opts: { fs: FSBackend; catalog: CatalogEntry[]; installRoot: string }) => MarketplaceService;
  buildReader: (opts: { fs: FSBackend }) => TemplateMetadataReader;
  seedInstalledIndex: (fs: FSBackend, installRoot: string, entries: InstalledEntry[]) => Promise<void>;
  installedEntryFor: (entry: CatalogEntry, installedPath: string) => InstalledEntry;
}

function buildService({
  fs,
  catalog,
  installRoot,
}: {
  fs: FSBackend;
  catalog: CatalogEntry[];
  installRoot: string;
}): MarketplaceService {
  const options: MarketplaceServiceOptions = {
    repoUrl: 'https://example.test',
    catalogPath: 'catalog.json',
    cachePath: '/test-workspace/.keepance/cache/templates.json',
    installRoot,
    fs,
    provenance: 'community',
  };
  const service = new MarketplaceService(options);
  // Pre-seed the in-memory cache so list() resolves without a network
  // round-trip, and mark it fresh so checkForUpdates short-circuits.
  const internal = service as unknown as {
    cache: CatalogEntry[] | null;
    lastFetchedAt: string | null;
    lastFetchFailed: boolean;
  };
  internal.cache = catalog;
  internal.lastFetchedAt = new Date().toISOString();
  internal.lastFetchFailed = false;
  return service;
}

function buildReader({ fs }: { fs: FSBackend }): TemplateMetadataReader {
  return new TemplateMetadataReader({ fs });
}

async function seedInstalledIndex(
  fs: FSBackend,
  installRoot: string,
  entries: InstalledEntry[],
): Promise<void> {
  await fs.write(`${installRoot}/.installed.json`, JSON.stringify({ entries }, null, 2));
}

function installedEntryFor(entry: CatalogEntry, installedPath: string): InstalledEntry {
  return {
    ...entry,
    installedAt: new Date().toISOString(),
    installedPath,
    provenance: 'community',
    manifestVersion: '1.0',
  };
}

const IS_TEST_MODE =
  typeof window !== 'undefined' && window.location.search.includes('testMode=true');

if (IS_TEST_MODE) {
  (window as unknown as { __marketplaceTestKit?: MarketplaceTestKit }).__marketplaceTestKit = {
    buildService,
    buildReader,
    seedInstalledIndex,
    installedEntryFor,
  };
}
