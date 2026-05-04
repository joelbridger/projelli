#!/usr/bin/env node
// projelli/projelli build-catalog.mjs
//
// Source of truth for the catalog-rebuild script that lives inside both
// community repos at scripts/build-catalog.mjs. The sync-to-github tooling
// copies this file verbatim into each repo, which is why the schema lives
// inline in this file rather than imported from the projelli app source.
//
// WHY the schemas are inlined (not imported):
//   The community repos are independent and run this script under GitHub
//   Actions with no access to the projelli app. So we vendor the Zod
//   manifest schemas here. This file MUST be kept in lockstep with:
//     - src/modules/marketplace/manifestValidator.ts (templates)
//     - src/modules/plugins/PluginManifestSchema.ts  (plugins)
//   Drift between them lets bad manifests reach end-users. The C6 sync
//   script regenerates this file from the app source before pushing to
//   the live repos.
//
// What this script does (per spec §6.8 and the Stream C6 plan):
//   1. Walks ./entries/<id>/.
//   2. For each entry: reads manifest.json, validates with the Zod schema
//      (templates or plugins, picked by env var PROJELLI_CATALOG_KIND).
//   3. Builds a deterministic tarball of the entry (excluding the
//      pre-existing tarball.tar.gz and checksum.txt) into
//      entries/<id>/tarball.tar.gz.
//   4. Computes SHA-256 of the tarball, writes entries/<id>/checksum.txt.
//   5. Generates ./catalog.json with all valid entries' CatalogEntry
//      shapes, sorted alphabetically by id for stable diffs.
//
// Local invocation just writes files. The GitHub Action commits + pushes.
//
// Usage:
//   PROJELLI_CATALOG_KIND=templates node scripts/build-catalog.mjs
//   PROJELLI_CATALOG_KIND=plugins   node scripts/build-catalog.mjs
//
// Optional env:
//   PROJELLI_CATALOG_REPO  Defaults to inferred owner/name from $GITHUB_REPOSITORY,
//                          falling back to "projelli/community-templates" or
//                          "projelli/community-plugins" depending on KIND.
//   PROJELLI_CATALOG_REF   Branch/ref the URLs should point at. Defaults to "main".
//   PROJELLI_CATALOG_ROOT  Path to the repo root the script should walk. Defaults
//                          to the current working directory.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Vendored Zod schemas (must match projelli app source)
// ---------------------------------------------------------------------------

const semverRegex = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;

const TEMPLATE_FILE_TYPES = ['markdown', 'interview-questions', 'workflow-definition'];

const templateFileEntrySchema = z.object({
  path: z.string().min(1, 'file.path required'),
  type: z.enum(TEMPLATE_FILE_TYPES),
});

const templateAuthorSchema = z.object({
  name: z.string().min(1, 'author.name required'),
  githubUser: z.string().min(1).optional(),
  url: z.url('author.url must be a URL').optional(),
});

const templateManifestSchema = z.object({
  id: z.string().min(1, 'id required'),
  name: z.string().min(1, 'name required'),
  version: z.string().regex(semverRegex, 'version must be semver'),
  apiVersion: z.string().min(1, 'apiVersion required'),
  author: templateAuthorSchema,
  description: z.string().min(1, 'description required'),
  category: z.string().min(1, 'category required'),
  tags: z.array(z.string()),
  screenshots: z.array(z.string().min(1)).optional(),
  files: z.array(templateFileEntrySchema).min(1, 'files must contain at least one entry'),
  minProjelliVersion: z.string().regex(semverRegex, 'minProjelliVersion must be semver'),
  maxProjelliVersion: z.string().regex(semverRegex, 'maxProjelliVersion must be semver').optional(),
});

const PLUGIN_PERMISSIONS = [
  'workspace:read',
  'workspace:write',
  'editor:selection',
  'editor:write',
  'ai:invoke',
  'network',
];

const pluginPermissionSchema = z.enum(PLUGIN_PERMISSIONS);

const pluginAuthorSchema = z.object({
  name: z.string().min(1, 'author.name required'),
  githubUser: z.string().min(1).optional(),
  url: z.url('author.url must be a URL').optional(),
});

const pluginManifestSchema = z.object({
  id: z.string().min(1, 'id required'),
  name: z.string().min(1, 'name required'),
  version: z.string().regex(semverRegex, 'version must be semver'),
  apiVersion: z.string().min(1, 'apiVersion required'),
  author: pluginAuthorSchema,
  description: z.string().min(1, 'description required'),
  main: z.string().min(1, 'main required'),
  permissions: z.array(pluginPermissionSchema),
  minProjelliVersion: z.string().regex(semverRegex, 'minProjelliVersion must be semver'),
  maxProjelliVersion: z.string().regex(semverRegex, 'maxProjelliVersion must be semver').optional(),
  category: z.string().min(1, 'category required'),
  tags: z.array(z.string()),
  screenshots: z.array(z.string().min(1)).optional(),
  homepage: z.url('homepage must be a URL').optional(),
  license: z.string().min(1).optional(),
});

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const KIND = process.env.PROJELLI_CATALOG_KIND;
if (KIND !== 'templates' && KIND !== 'plugins') {
  console.error(
    'PROJELLI_CATALOG_KIND must be "templates" or "plugins". Got:',
    KIND ?? '<unset>',
  );
  process.exit(1);
}

const REPO_ROOT = resolve(process.env.PROJELLI_CATALOG_ROOT ?? process.cwd());
const ENTRIES_DIR = join(REPO_ROOT, 'entries');
const REF = process.env.PROJELLI_CATALOG_REF ?? 'main';

function inferRepo() {
  if (process.env.PROJELLI_CATALOG_REPO) return process.env.PROJELLI_CATALOG_REPO;
  if (process.env.GITHUB_REPOSITORY) return process.env.GITHUB_REPOSITORY;
  return KIND === 'templates' ? 'projelli/community-templates' : 'projelli/community-plugins';
}
const REPO = inferRepo();

// Fixed mtime for reproducible tarballs. Real bytes change only when entry
// contents change, so SHA-256 stays stable across CI runs.
const REPRODUCIBLE_MTIME = '2026-01-01 00:00:00 UTC';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function listEntryDirs() {
  if (!existsSync(ENTRIES_DIR)) return [];
  return readdirSync(ENTRIES_DIR)
    .filter((name) => {
      const abs = join(ENTRIES_DIR, name);
      try {
        return statSync(abs).isDirectory();
      } catch {
        return false;
      }
    })
    .sort();
}

function validateManifest(raw) {
  const schema = KIND === 'templates' ? templateManifestSchema : pluginManifestSchema;
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const errors = parsed.error.issues.map((i) => {
      const p = i.path.join('.') || '<root>';
      return `${p}: ${i.message}`;
    });
    return { ok: false, errors };
  }
  return { ok: true, manifest: parsed.data };
}

function rawUrl(repo, ref, repoRelativePath) {
  return `https://raw.githubusercontent.com/${repo}/${ref}/${repoRelativePath}`;
}

/**
 * Build a deterministic tarball of the entry directory. We copy the entry's
 * payload into a temp dir (skipping tarball.tar.gz and checksum.txt to avoid
 * including stale build outputs from previous runs), then tar that. The
 * `--mtime`, `--sort=name`, `--owner`, `--group`, `--numeric-owner` flags
 * make the byte output reproducible across machines and CI runs.
 */
function buildTarball(entryAbsDir, entryId) {
  const stagingRoot = mkdtempSync(join(tmpdir(), `projelli-catalog-${entryId}-`));
  const stagingEntry = join(stagingRoot, entryId);
  spawnSync('mkdir', ['-p', stagingEntry], { stdio: 'inherit' });

  // Copy everything except the build outputs themselves.
  const cpResult = spawnSync(
    'sh',
    [
      '-c',
      // -a preserves mode + symlinks; the trailing /. copies dotfiles too.
      `cp -a "${entryAbsDir}/." "${stagingEntry}/" && rm -f "${stagingEntry}/tarball.tar.gz" "${stagingEntry}/checksum.txt"`,
    ],
    { stdio: 'inherit' },
  );
  if (cpResult.status !== 0) {
    rmSync(stagingRoot, { recursive: true, force: true });
    throw new Error(`Failed to stage entry ${entryId} for tar`);
  }

  const tarballPath = join(entryAbsDir, 'tarball.tar.gz');
  const tarResult = spawnSync(
    'tar',
    [
      '--sort=name',
      `--mtime=${REPRODUCIBLE_MTIME}`,
      '--owner=0',
      '--group=0',
      '--numeric-owner',
      '-czf',
      tarballPath,
      '-C',
      stagingRoot,
      entryId,
    ],
    { stdio: 'inherit' },
  );

  rmSync(stagingRoot, { recursive: true, force: true });

  if (tarResult.status !== 0) {
    throw new Error(`tar failed for ${entryId}`);
  }
  return tarballPath;
}

function sha256OfFile(path) {
  const hash = createHash('sha256');
  hash.update(readFileSync(path));
  return hash.digest('hex');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const dirs = listEntryDirs();
  console.log(`[build-catalog] kind=${KIND} repo=${REPO} ref=${REF} entries=${dirs.length}`);

  const catalogEntries = [];
  const errors = [];

  for (const id of dirs) {
    const entryDir = join(ENTRIES_DIR, id);
    const manifestPath = join(entryDir, 'manifest.json');

    if (!existsSync(manifestPath)) {
      errors.push(`${id}: missing manifest.json`);
      continue;
    }

    let raw;
    try {
      raw = JSON.parse(readFileSync(manifestPath, 'utf-8'));
    } catch (err) {
      errors.push(`${id}: manifest.json parse error: ${err.message}`);
      continue;
    }

    const result = validateManifest(raw);
    if (!result.ok) {
      for (const e of result.errors) errors.push(`${id}: ${e}`);
      continue;
    }
    const manifest = result.manifest;

    if (manifest.id !== id) {
      errors.push(`${id}: manifest.id "${manifest.id}" does not match folder name`);
      continue;
    }

    let tarballPath;
    try {
      tarballPath = buildTarball(entryDir, id);
    } catch (err) {
      errors.push(`${id}: ${err.message}`);
      continue;
    }

    const checksum = sha256OfFile(tarballPath);
    writeFileSync(join(entryDir, 'checksum.txt'), `${checksum}\n`, 'utf-8');

    const screenshotsRel = (manifest.screenshots ?? []).map((s) =>
      rawUrl(REPO, REF, `entries/${id}/${s}`),
    );

    const now = new Date().toISOString();

    /** @type {Record<string, unknown>} */
    const catalogEntry = {
      id: manifest.id,
      name: manifest.name,
      description: manifest.description,
      version: manifest.version,
      author: manifest.author,
      category: manifest.category,
      tags: manifest.tags,
      installUrl: rawUrl(REPO, REF, `entries/${id}/tarball.tar.gz`),
      manifestUrl: rawUrl(REPO, REF, `entries/${id}/manifest.json`),
      minProjelliVersion: manifest.minProjelliVersion,
      publishedAt: now,
      updatedAt: now,
      checksum,
    };
    if (screenshotsRel.length > 0) catalogEntry.screenshots = screenshotsRel;
    if (manifest.maxProjelliVersion) catalogEntry.maxProjelliVersion = manifest.maxProjelliVersion;

    catalogEntries.push(catalogEntry);
    console.log(`[build-catalog] ok: ${id} v${manifest.version} sha256=${checksum.slice(0, 12)}...`);
  }

  if (errors.length > 0) {
    console.error(`\n[build-catalog] ${errors.length} validation error(s):`);
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  }

  catalogEntries.sort((a, b) => a.id.localeCompare(b.id));

  const catalogPath = join(REPO_ROOT, 'catalog.json');
  writeFileSync(catalogPath, `${JSON.stringify(catalogEntries, null, 2)}\n`, 'utf-8');
  console.log(`\n[build-catalog] wrote ${catalogPath} (${catalogEntries.length} entries)`);
}

main();
