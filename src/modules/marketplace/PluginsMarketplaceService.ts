// PluginsMarketplaceService — concrete service binding for the community
// plugins marketplace. Composes the generic `MarketplaceService` skeleton
// with plugin-specific defaults: the plugins repo URL, plugin install
// paths under the workspace root, the plugin manifest validator, and an
// audit emitter that fires the plugin_* event family.
//
// Mirrors `TemplatesMarketplaceService` (Stream C1). The same install /
// uninstall / listInstalled / checkForUpdates surface; only the validator,
// install root, cache path, and audit event shape differ.

import type { FSBackend } from '@/modules/workspace/types';
import type { PluginManifest, PluginPermission } from '@/types/plugin';
import {
  MarketplaceService,
  type ManifestValidator,
  type MarketplaceAuditEmitter,
  type ValidatedMarketplaceManifest,
} from './MarketplaceService';
import { validatePluginManifest } from '@/modules/plugins/PluginManifestSchema';

export const PLUGINS_REPO_URL =
  'https://raw.githubusercontent.com/keepance/community-plugins/main';
export const PLUGINS_CATALOG_PATH = 'catalog.json';

export interface CreatePluginsMarketplaceOptions {
  /** Override the plugins repo URL (used by tests + dev mirrors). */
  repoUrl?: string;
  /** Override the catalog path within the repo. */
  catalogPath?: string;
}

/**
 * Plugin-specific manifest validator. Wraps `validatePluginManifest` so the
 * shared MarketplaceService pipeline can call it with the same shape it uses
 * for the template validator.
 */
const pluginValidator: ManifestValidator = (raw) => {
  const result = validatePluginManifest(raw);
  if (!result.ok) return { ok: false, errors: result.errors };
  return { ok: true, manifest: result.manifest as unknown as ValidatedMarketplaceManifest };
};

/**
 * Audit emitter that maps the marketplace lifecycle events onto the
 * plugin_* AuditEvent variants from `src/types/audit.ts`. Permission lists
 * are forwarded so the security audit captures exactly what the user
 * approved at install time.
 */
const pluginAuditEmitter: MarketplaceAuditEmitter = {
  installSucceeded: (audit, { id, version, manifest }) => {
    const permissions: PluginPermission[] =
      (manifest as Partial<PluginManifest>).permissions ?? [];
    audit.append({
      type: 'plugin_installed',
      timestamp: new Date().toISOString(),
      payload: { id, version, permissions },
    });
  },
  installFailed: (audit, { id, error }) => {
    // `source: 'marketplace'` distinguishes catalog installs from sideloads
    // (the C5 dev tooling uses `source: 'sideload'`).
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
    // No `plugin_updated` event variant exists yet (deferred to a future
    // audit type expansion); log the update as a fresh install with the
    // post-update version + (empty for now) permissions. PluginManager owns
    // the actual update lifecycle in C3 and emits its own richer events.
    audit.append({
      type: 'plugin_installed',
      timestamp: new Date().toISOString(),
      payload: { id, version: toVersion, permissions: [] },
    });
  },
};

/**
 * Build a `MarketplaceService` configured for the community plugins repo.
 *
 * Cache lives at `<workspaceRoot>/.keepance/cache/plugins.json` so multiple
 * Keepance windows pointed at the same workspace see the same cached
 * catalog. Installs land under `<workspaceRoot>/.keepance/plugins/<id>/`.
 *
 * The returned service uses `validatePluginManifest` for manifest validation
 * and emits plugin_* audit events instead of template_* events.
 */
export function createPluginsMarketplaceService(
  fs: FSBackend,
  workspaceRoot: string,
  opts: CreatePluginsMarketplaceOptions = {},
): MarketplaceService {
  const root = stripTrailingSlash(workspaceRoot);
  return new MarketplaceService({
    repoUrl: opts.repoUrl ?? PLUGINS_REPO_URL,
    catalogPath: opts.catalogPath ?? PLUGINS_CATALOG_PATH,
    cachePath: `${root}/.keepance/cache/plugins.json`,
    installRoot: `${root}/.keepance/plugins`,
    fs,
    provenance: 'community',
    validator: pluginValidator,
    auditEmitter: pluginAuditEmitter,
  });
}

function stripTrailingSlash(p: string): string {
  return p.endsWith('/') ? p.slice(0, -1) : p;
}
