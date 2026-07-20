// Zod schema + validation for community template manifests.
//
// The marketplace install pipeline calls `validateTemplateManifest(raw)`
// after extracting a tarball; the schema is also exported so the
// `community-templates` GitHub Action (Stream C6) can reuse the exact same
// rules during PR validation. Drift between the two would let bad manifests
// reach end-users, so this file is the single source of truth.

import { z } from 'zod';
import type {
  TemplateManifest,
  TemplateFileType,
} from '@/features/workflows/types/templateManifest';
import { brandText } from '@/config/brandText';
import { BRAND } from '@/config/brand';

const TEMPLATE_FILE_TYPES: readonly TemplateFileType[] = [
  'markdown',
  'interview-questions',
  'workflow-definition',
] as const;

const semverRegex = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;

export const templateFileEntrySchema = z.object({
  path: z.string().min(1, 'file.path required'),
  type: z.enum(TEMPLATE_FILE_TYPES as unknown as [TemplateFileType, ...TemplateFileType[]]),
});

export const templateManifestAuthorSchema = z.object({
  name: z.string().min(1, 'author.name required'),
  githubUser: z.string().min(1).optional(),
  url: z.url('author.url must be a URL').optional(),
});

export const templateManifestSchema = z.object({
  id: z.string().min(1, 'id required'),
  name: z.string().min(1, 'name required'),
  version: z.string().regex(semverRegex, 'version must be semver'),
  apiVersion: z.string().min(1, 'apiVersion required'),
  author: templateManifestAuthorSchema,
  description: z.string().min(1, 'description required'),
  category: z.string().min(1, 'category required'),
  tags: z.array(z.string()),
  screenshots: z.array(z.string().min(1)).optional(),
  files: z.array(templateFileEntrySchema).min(1, 'files must contain at least one entry'),
  minAppVersion: z.string().regex(semverRegex, 'minAppVersion must be semver'),
  maxAppVersion: z
    .string()
    .regex(semverRegex, 'maxAppVersion must be semver')
    .optional(),
});

export type TemplateManifestValidationResult =
  | { ok: true; manifest: TemplateManifest }
  | { ok: false; errors: string[] };

export function validateTemplateManifest(
  raw: unknown,
): TemplateManifestValidationResult {
  const parsed = templateManifestSchema.safeParse(raw);
  if (!parsed.success) {
    const errors = parsed.error.issues.map((i) => {
      const path = i.path.join('.') || '<root>';
      return `${path}: ${i.message}`;
    });
    return { ok: false, errors };
  }
  return { ok: true, manifest: parsed.data as TemplateManifest };
}

/**
 * Compare two semver strings. Returns -1, 0, 1. Pre-release / build metadata
 * are ignored for the comparison (good enough for the "manifest needs newer
 * Lantern" check; full semver would be overkill here).
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
 * Returns an error string if `manifest.minAppVersion` is newer than the
 * current app version, otherwise null. Callers fail the install with the
 * returned message.
 */
export function checkMinAppVersion(
  manifest: TemplateManifest,
  currentAppVersion: string,
): string | null {
  if (compareSemver(manifest.minAppVersion, currentAppVersion) > 0) {
    return brandText(`Template requires ${BRAND.name} ${manifest.minAppVersion} or newer (you have ${currentAppVersion}).`);
  }
  return null;
}
