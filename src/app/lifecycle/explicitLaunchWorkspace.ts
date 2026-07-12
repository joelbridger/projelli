/**
 * The desktop host injects this value only for an explicit, already-validated
 * `--workspace` or `LANTERN_WORKSPACE` launch. It is intentionally separate
 * from `?testMode=true`: this opens a real on-disk workspace through the
 * normal lifecycle instead of creating test-only in-memory state.
 */
export function getExplicitLaunchWorkspace(): string | null {
  if (typeof window === 'undefined') return null;

  const value = (window as Window & { __LANTERN_WORKSPACE__?: unknown })
    .__LANTERN_WORKSPACE__;
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

export function shouldShowFirstRunForLaunch({
  onboardingComplete,
  noRecentWorkspaces,
  isTestMode,
  isDemoMode,
  hasExplicitWorkspace,
  forceOnboarding,
}: {
  onboardingComplete: boolean;
  noRecentWorkspaces: boolean;
  isTestMode: boolean;
  isDemoMode: boolean;
  hasExplicitWorkspace: boolean;
  forceOnboarding: boolean;
}): boolean {
  if (forceOnboarding) return true;

  return (
    !onboardingComplete &&
    noRecentWorkspaces &&
    !isTestMode &&
    !isDemoMode &&
    !hasExplicitWorkspace
  );
}
