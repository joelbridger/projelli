// scripts/lib/scopedStorage.mjs — read the app's PER-WORKSPACE persisted stores
// from an external Playwright browser context (QA-93 round 2).
//
// matter/client-map state persists per workspace under `<base>::ws:<id>` keys;
// with a workspace open the app writes ONLY the scoped key, so a raw
// `localStorage.getItem('lantern:matters')` (the legacy GLOBAL key) sees null.
// This helper resolves the active workspace's scoped key — the app publishes its
// suffix on `window.__lanternWorkspaceScopeSuffix` — and falls back to the global
// key when no workspace is open (or the scoped key is absent), so it stays
// correct both before and after a workspace loads.
//
// Shared by the robot/demo harness (.mjs) and the e2e specs (which re-export it
// via tests/e2e/helpers/scopedStorage.ts). Both drive a Playwright `page`, and
// the resolver runs inside `page.evaluate`, so it must stay dependency-free.

export const MATTERS_KEY = 'lantern:matters';
export const CLIENT_MAPS_KEY = 'lantern:client-maps';

/**
 * Read the raw string value of a per-workspace-scoped store, resolving the active
 * workspace's scoped key with a global-key fallback.
 * @param {import('playwright').Page} page
 * @param {string} baseKey e.g. `lantern:matters`
 * @returns {Promise<string|null>}
 */
export async function readWorkspaceScopedRaw(page, baseKey) {
  return page.evaluate((key) => {
    const suffix = window.__lanternWorkspaceScopeSuffix;
    if (suffix) {
      const scoped = localStorage.getItem(key + suffix);
      if (scoped !== null) return scoped;
    }
    return localStorage.getItem(key);
  }, baseKey);
}

/**
 * Read + JSON.parse a per-workspace-scoped store. Returns null on missing or
 * unparseable data.
 * @template T
 * @param {import('playwright').Page} page
 * @param {string} baseKey
 * @returns {Promise<T|null>}
 */
export async function readWorkspaceScopedJSON(page, baseKey) {
  const raw = await readWorkspaceScopedRaw(page, baseKey);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Read the current workspace's matters array (`[]` if none).
 * @param {import('playwright').Page} page
 * @returns {Promise<Array<Record<string, unknown>>>}
 */
export async function readWorkspaceMatters(page) {
  const parsed = await readWorkspaceScopedJSON(page, MATTERS_KEY);
  return parsed?.state?.matters ?? [];
}
