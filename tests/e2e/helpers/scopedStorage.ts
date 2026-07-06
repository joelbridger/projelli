// tests/e2e/helpers/scopedStorage.ts — typed wrapper over the shared per-workspace
// storage reader (QA-93 round 2).
//
// The app persists matter/client-map state per workspace under `<base>::ws:<id>`
// keys; a raw `localStorage.getItem('lantern:matters')` (the legacy GLOBAL key)
// sees null once a workspace is open. Use these helpers in e2e specs instead of
// reading the literal key, so the assertion resolves the SAME scoped key the app
// wrote (falling back to the global key when no workspace is active). The
// resolver logic lives in `scripts/lib/scopedStorage.mjs` (shared with the
// robot/demo harness).

import type { Page } from '@playwright/test';

export const MATTERS_KEY = 'lantern:matters';
export const CLIENT_MAPS_KEY = 'lantern:client-maps';

/** Read the raw value of a per-workspace-scoped store (scoped key, global fallback). */
export async function readWorkspaceScopedRaw(page: Page, baseKey: string): Promise<string | null> {
  return page.evaluate((key) => {
    const suffix = (window as unknown as { __lanternWorkspaceScopeSuffix?: string })
      .__lanternWorkspaceScopeSuffix;
    if (suffix) {
      const scoped = localStorage.getItem(key + suffix);
      if (scoped !== null) return scoped;
    }
    return localStorage.getItem(key);
  }, baseKey);
}

/** Read + JSON.parse a per-workspace-scoped store; null on missing/unparseable. */
export async function readWorkspaceScopedJSON<T = unknown>(page: Page, baseKey: string): Promise<T | null> {
  const raw = await readWorkspaceScopedRaw(page, baseKey);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}
