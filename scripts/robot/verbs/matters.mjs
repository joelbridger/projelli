// scripts/robot/verbs/matters.mjs — resolve a client/household's CURRENT matter
// id by display name.
//
// Matter ids are NOT stable across seeds: onboarding/CRM (Wealthbox) sync
// assigns a fresh random UUID (`matter_<uuid>`) to each client on every reseed,
// replacing the old fixed demo-slug scheme (`matter_nc_hollings_family`, etc.)
// that earlier verbs hardcoded. Look the id up by name at runtime instead of
// assuming it never changes.

/**
 * @param {import('playwright').Page} page
 * @param {string} nameSubstring case-insensitive substring of the matter's display name
 * @returns {Promise<string|null>}
 */
export async function resolveMatterId(page, nameSubstring) {
  return page.evaluate((needle) => {
    try {
      const raw = localStorage.getItem('lantern:matters');
      if (!raw) return null;
      const matters = JSON.parse(raw)?.state?.matters ?? [];
      const hit = matters.find((m) => String(m.name || '').toLowerCase().includes(needle.toLowerCase()));
      return hit ? hit.id : null;
    } catch {
      return null;
    }
  }, nameSubstring);
}
