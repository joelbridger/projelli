/**
 * Live-network integration test for the seed catalog (Stream C6 Group VI,
 * Task 6.1).
 *
 * Hits the actual `keepance/community-templates` repo on raw.githubusercontent.com
 * and verifies the end-to-end shape:
 *
 *   1. catalog.json fetches with HTTP 200 and parses as CatalogEntry[].
 *   2. Each entry has the fields the in-app marketplace UI requires
 *      (id, name, version, installUrl, manifestUrl, checksum).
 *   3. One real tarball downloads, and its actual SHA-256 matches the
 *      catalog-declared checksum (catches bot drift, force pushes, or a
 *      tampered repo).
 *   4. The corresponding manifest.json fetches and validates against the
 *      vendored Zod schema the in-app installer uses (templates schema for
 *      templates schema for community-templates).
 *
 * Gated behind `LIVE_NETWORK_OK=1` so CI does not hit GitHub on every push;
 * Jameson runs it manually after the seed catalog is live or after merging
 * a new catalog entry.
 *
 * Run locally:
 *   LIVE_NETWORK_OK=1 npm run test -- marketplace-fetch-from-live-repos
 */

import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { validateTemplateManifest } from '@/features/workflows/marketplace/svc/manifestValidator';
import type { CatalogEntry } from '@/features/workflows/types/marketplace';

const LIVE_OK = process.env['LIVE_NETWORK_OK'] === '1';

const TEMPLATES_CATALOG_URL =
  'https://raw.githubusercontent.com/keepance/community-templates/main/catalog.json';
function assertCatalogShape(catalog: unknown): asserts catalog is CatalogEntry[] {
  expect(Array.isArray(catalog)).toBe(true);
  const arr = catalog as unknown[];
  for (const raw of arr) {
    expect(raw).toBeTypeOf('object');
    const entry = raw as Record<string, unknown>;
    expect(typeof entry['id']).toBe('string');
    expect(typeof entry['name']).toBe('string');
    expect(typeof entry['description']).toBe('string');
    expect(typeof entry['version']).toBe('string');
    expect(typeof entry['category']).toBe('string');
    expect(Array.isArray(entry['tags'])).toBe(true);
    expect(typeof entry['installUrl']).toBe('string');
    expect(typeof entry['manifestUrl']).toBe('string');
    expect(typeof entry['minAppVersion']).toBe('string');
    expect(typeof entry['publishedAt']).toBe('string');
    expect(typeof entry['updatedAt']).toBe('string');
    expect(typeof entry['checksum']).toBe('string');
    expect((entry['checksum'] as string).length).toBeGreaterThan(0);
    expect(typeof entry['author']).toBe('object');
  }
}

async function sha256OfUrl(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch ${url}: HTTP ${res.status}`);
  }
  const buf = new Uint8Array(await res.arrayBuffer());
  return createHash('sha256').update(buf).digest('hex');
}

describe.skipIf(!LIVE_OK)('marketplace fetch from live community repos', () => {
  it('fetches the live community-templates catalog with the expected shape', async () => {
    const res = await fetch(TEMPLATES_CATALOG_URL);
    expect(res.ok).toBe(true);
    expect(res.status).toBe(200);

    const catalog = (await res.json()) as unknown;
    assertCatalogShape(catalog);
    expect(catalog.length).toBeGreaterThanOrEqual(5);

    for (const entry of catalog) {
      expect(entry.installUrl).toMatch(
        /^https:\/\/raw\.githubusercontent\.com\/keepance\/community-templates\/main\/entries\//,
      );
      expect(entry.installUrl).toMatch(/tarball\.tar\.gz$/);
      expect(entry.manifestUrl).toMatch(
        /^https:\/\/raw\.githubusercontent\.com\/keepance\/community-templates\/main\/entries\//,
      );
      expect(entry.manifestUrl).toMatch(/manifest\.json$/);
    }
  }, 30_000);


  it('downloads one real template tarball and confirms its SHA-256 matches the catalog checksum', async () => {
    const res = await fetch(TEMPLATES_CATALOG_URL);
    const catalog = (await res.json()) as CatalogEntry[];
    const entry = catalog[0];
    expect(entry).toBeDefined();
    if (!entry) return;

    const actual = await sha256OfUrl(entry.installUrl);
    expect(actual).toBe(entry.checksum);
  }, 60_000);


  it('fetches a real template manifest.json and validates it against the in-app Zod schema', async () => {
    const res = await fetch(TEMPLATES_CATALOG_URL);
    const catalog = (await res.json()) as CatalogEntry[];
    const entry = catalog[0];
    expect(entry).toBeDefined();
    if (!entry) return;

    const manifestRes = await fetch(entry.manifestUrl);
    expect(manifestRes.ok).toBe(true);
    const raw = (await manifestRes.json()) as unknown;

    const result = validateTemplateManifest(raw);
    if (!result.ok) {
      throw new Error(
        `Template manifest validation failed for ${entry.id}: ${result.errors.join(', ')}`,
      );
    }
    expect(result.manifest.id).toBe(entry.id);
    expect(result.manifest.version).toBe(entry.version);
  }, 60_000);
});

describe.skipIf(LIVE_OK)('marketplace fetch from live community repos (skipped)', () => {
  it('is gated behind LIVE_NETWORK_OK=1 to keep CI offline', () => {
    expect(LIVE_OK).toBe(false);
  });
});
