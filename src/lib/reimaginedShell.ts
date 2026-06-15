/**
 * Whether to render the reimagined matter-centric shell.
 *
 * Default: ON for every profession. The reimagined shell IS the Keepance 3.0
 * product (it adapts per vertical: law sees Matters, tax sees Clients,
 * consulting sees Engagements), so it is the universal default rather than a
 * law-only experience. The `shell` query param overrides: `?shell=new` forces
 * it on, `?shell=old` forces the legacy shell (the escape hatch + how
 * shell-specific legacy tests opt out). One source of truth shared by
 * AppShellNav and the App's Trust Bar.
 */
export function isReimaginedShell(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const shell = new URLSearchParams(window.location.search).get('shell');
    if (shell !== null) return shell !== 'old';
    return true;
  } catch {
    return false;
  }
}
