// scripts/robot/verbs/matters.mjs — resolve a client/household's CURRENT matter
// id by display name.
//
// Matter ids are NOT stable across seeds: onboarding/CRM (Wealthbox) sync
// assigns a fresh random UUID (`matter_<uuid>`) to each client on every reseed,
// replacing the old fixed demo-slug scheme (`matter_nc_hollings_family`, etc.)
// that earlier verbs hardcoded. Look the id up by name at runtime instead of
// assuming it never changes.

import { readWorkspaceMatters } from '../../lib/scopedStorage.mjs';

/**
 * @param {import('playwright').Page} page
 * @param {string} nameSubstring case-insensitive substring of the matter's display name
 * @returns {Promise<string|null>}
 */
export async function resolveMatterId(page, nameSubstring) {
  // QA-93: matters persist under a PER-WORKSPACE scoped key — read via the shared
  // resolver (scoped key, global fallback) rather than the legacy global key.
  const matters = await readWorkspaceMatters(page);
  const needle = nameSubstring.toLowerCase();
  const hit = matters.find((m) => String(m.name || '').toLowerCase().includes(needle));
  return hit ? String(hit.id) : null;
}
