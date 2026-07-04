// TemplatesMarketplaceService — concrete service binding for the community
// templates marketplace. Wires the generic `MarketplaceService` to the
// templates repo URL, default cache + install paths under the workspace
// root, and a `community` provenance stamp on installed entries.

import type { FSBackend } from '@/platform/fs/types';
import { MarketplaceService } from './MarketplaceService';
import { WORKSPACE_DATA_DIR } from '@/config/identity';

export const TEMPLATES_REPO_URL =
  'https://raw.githubusercontent.com/keepance/community-templates/main';
export const TEMPLATES_CATALOG_PATH = 'catalog.json';

export interface CreateTemplatesMarketplaceOptions {
  /** Override the templates repo URL (used by tests + dev mirrors). */
  repoUrl?: string;
  /** Override the catalog path within the repo. */
  catalogPath?: string;
}

/**
 * Build a `MarketplaceService` configured for the community templates repo.
 *
 * Cache lives at `<workspaceRoot>/.lantern/cache/templates.json` so multiple
 * Advisor Prep Hero windows pointed at the same workspace see the same cached catalog.
 * Installs land under `<workspaceRoot>/.lantern/templates/<id>/`.
 */
export function createTemplatesMarketplaceService(
  fs: FSBackend,
  workspaceRoot: string,
  opts: CreateTemplatesMarketplaceOptions = {},
): MarketplaceService {
  const root = stripTrailingSlash(workspaceRoot);
  return new MarketplaceService({
    repoUrl: opts.repoUrl ?? TEMPLATES_REPO_URL,
    catalogPath: opts.catalogPath ?? TEMPLATES_CATALOG_PATH,
    cachePath: `${root}/${WORKSPACE_DATA_DIR}/cache/templates.json`,
    installRoot: `${root}/${WORKSPACE_DATA_DIR}/templates`,
    fs,
    provenance: 'community',
  });
}

function stripTrailingSlash(p: string): string {
  return p.endsWith('/') ? p.slice(0, -1) : p;
}
