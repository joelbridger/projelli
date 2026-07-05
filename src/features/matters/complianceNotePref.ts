// R5 (Tier B trust guard) — the advisor's remembered choice for the "also file
// a compliance note" toggle in SOLO tier. In firm tier the toggle defaults ON
// (supervisory provenance shouldn't be opt-in); solo tier keeps the advisor's
// own choice and remembers it. Default (nothing stored) is OFF for solo.
const KEY = 'kp-crm-compliance-note-remembered';

export function getRememberedComplianceNoteChoice(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

export function setRememberedComplianceNoteChoice(remembered: boolean): void {
  try {
    if (remembered) localStorage.setItem(KEY, '1');
    else localStorage.removeItem(KEY);
  } catch {
    /* no storage — falls back to the OFF default, which is safe */
  }
}
