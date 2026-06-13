import { isLawExperience } from '@/stores/professionStore';

/**
 * Whether to render the reimagined matter-centric shell.
 *
 * Default: ON for the legal experience (law is the lead ICP and the product's
 * identity). Explicit overrides via the `shell` query param: `?shell=new`
 * forces it on (e.g. for a non-legal profile demo), `?shell=old` forces the
 * legacy shell (the escape hatch + how shell-specific legacy tests opt out).
 * One source of truth shared by AppShellNav and the App's Trust Bar.
 */
export function isReimaginedShell(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const shell = new URLSearchParams(window.location.search).get('shell');
    if (shell !== null) return shell !== 'old';
    return isLawExperience();
  } catch {
    return false;
  }
}
