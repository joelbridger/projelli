/**
 * Feature flag for the reimagined matter-centric shell. Enabled with the
 * `?shell=new` query param while the new experience is built out, so the
 * production default and its tests stay untouched. One source of truth shared
 * by AppShellNav and the App's Trust Bar insertion.
 */
export function isReimaginedShell(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return new URLSearchParams(window.location.search).has('shell');
  } catch {
    return false;
  }
}
