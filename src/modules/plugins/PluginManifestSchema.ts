// Zod v4 schema + validator for plugin manifests.
//
// The PluginManager calls `validatePluginManifest(raw)` after extracting a
// plugin tarball; the same schema is exported so a future community-plugins
// pipeline (Stream C5/C6) can reuse the exact rules during PR validation.
// Drift between the two would let bad manifests reach end-users, so this
// file is the single source of truth.
//
// Modeled on `src/modules/marketplace/manifestValidator.ts` (Stream C1).
// Same idiom, different fields. Plugin manifests carry a `main` entry, a
// `permissions` array of literal strings, and optional `homepage`/`license`.
//
// Spec: docs/superpowers/specs/2026-04-28-v2.0-mega-release-design.md §6.4

import { z } from 'zod';
import type { PluginManifest, PluginPermission } from '@/types/plugin';

const PLUGIN_PERMISSIONS: readonly PluginPermission[] = [
  'workspace:read',
  'workspace:write',
  'editor:selection',
  'editor:write',
  'ai:invoke',
  'network',
] as const;

const semverRegex = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;

export const pluginPermissionSchema = z.enum(
  PLUGIN_PERMISSIONS as unknown as [PluginPermission, ...PluginPermission[]],
);

export const pluginManifestAuthorSchema = z.object({
  name: z.string().min(1, 'author.name required'),
  githubUser: z.string().min(1).optional(),
  url: z.url('author.url must be a URL').optional(),
});

export const pluginManifestSchema = z.object({
  id: z.string().min(1, 'id required'),
  name: z.string().min(1, 'name required'),
  version: z.string().regex(semverRegex, 'version must be semver'),
  apiVersion: z.string().min(1, 'apiVersion required'),
  author: pluginManifestAuthorSchema,
  description: z.string().min(1, 'description required'),
  main: z.string().min(1, 'main required'),
  permissions: z.array(pluginPermissionSchema),
  minProjelliVersion: z.string().regex(semverRegex, 'minProjelliVersion must be semver'),
  maxProjelliVersion: z
    .string()
    .regex(semverRegex, 'maxProjelliVersion must be semver')
    .optional(),
  category: z.string().min(1, 'category required'),
  tags: z.array(z.string()),
  screenshots: z.array(z.string().min(1)).optional(),
  homepage: z.url('homepage must be a URL').optional(),
  license: z.string().min(1).optional(),
});

export type PluginManifestValidationResult =
  | { ok: true; manifest: PluginManifest }
  | { ok: false; errors: string[] };

export function validatePluginManifest(raw: unknown): PluginManifestValidationResult {
  const parsed = pluginManifestSchema.safeParse(raw);
  if (!parsed.success) {
    const errors = parsed.error.issues.map((i) => {
      const path = i.path.join('.') || '<root>';
      return `${path}: ${i.message}`;
    });
    return { ok: false, errors };
  }
  return { ok: true, manifest: parsed.data as PluginManifest };
}

/**
 * Compare two semver strings. Returns -1, 0, 1. Pre-release / build metadata
 * are ignored for the comparison (good enough for "manifest needs newer
 * Projelli" gating; full semver would be overkill here). Same algorithm as
 * the marketplace `compareSemver`; duplicated to avoid a cross-module import.
 */
export function compareSemver(a: string, b: string): number {
  const norm = (v: string) => {
    const core = v.split(/[-+]/)[0] ?? v;
    return core.split('.').map((n) => parseInt(n, 10) || 0);
  };
  const aa = norm(a);
  const bb = norm(b);
  for (let i = 0; i < 3; i += 1) {
    const av = aa[i] ?? 0;
    const bv = bb[i] ?? 0;
    if (av < bv) return -1;
    if (av > bv) return 1;
  }
  return 0;
}

/**
 * Returns an error string if `manifest.minProjelliVersion` is newer than the
 * current app version, otherwise null. Callers fail the install with the
 * returned message.
 */
export function checkMinProjelliVersion(
  manifest: PluginManifest,
  currentAppVersion: string,
): string | null {
  if (compareSemver(manifest.minProjelliVersion, currentAppVersion) > 0) {
    return `Plugin requires Projelli ${manifest.minProjelliVersion} or newer (you have ${currentAppVersion}).`;
  }
  return null;
}

/**
 * Returns an error string if the current app version is newer than the
 * declared `maxProjelliVersion`, otherwise null. The `maxProjelliVersion`
 * field is optional; an absent field never triggers an error.
 */
export function checkMaxProjelliVersion(
  manifest: PluginManifest,
  currentAppVersion: string,
): string | null {
  if (!manifest.maxProjelliVersion) return null;
  if (compareSemver(currentAppVersion, manifest.maxProjelliVersion) > 0) {
    return `Plugin supports Projelli up to ${manifest.maxProjelliVersion} (you have ${currentAppVersion}).`;
  }
  return null;
}
