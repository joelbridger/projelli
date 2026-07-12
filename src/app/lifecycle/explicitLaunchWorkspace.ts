/**
 * The desktop host injects this value only in a debug build. Keep this guard
 * beside the reader: a release renderer must treat even an injected global as
 * inert, matching the Rust host's `#[cfg(debug_assertions)]` gate.
 */
export function resolveExplicitLaunchWorkspace(
  value: unknown,
  isDebugBuild: boolean
): string | null {
  if (!isDebugBuild || typeof value !== 'string' || value.trim().length === 0) {
    return null;
  }
  return value;
}

export function getExplicitLaunchWorkspace(): string | null {
  if (typeof window === 'undefined') return null;

  return resolveExplicitLaunchWorkspace(
    (window as Window & { __LANTERN_WORKSPACE__?: unknown })
      .__LANTERN_WORKSPACE__,
    import.meta.env.DEV
  );
}

/** The debug-only path is permitted solely for a genuinely blank first run. */
export function shouldUseExplicitLaunchWorkspace({
  hasCandidate,
  onboardingComplete,
  recentWorkspacesLoaded,
  noRecentWorkspaces,
  isTestMode,
  isDemoMode,
}: {
  hasCandidate: boolean;
  onboardingComplete: boolean;
  recentWorkspacesLoaded: boolean;
  noRecentWorkspaces: boolean;
  isTestMode: boolean;
  isDemoMode: boolean;
}): boolean {
  return (
    hasCandidate &&
    !onboardingComplete &&
    recentWorkspacesLoaded &&
    noRecentWorkspaces &&
    !isTestMode &&
    !isDemoMode
  );
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
