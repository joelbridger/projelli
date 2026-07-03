/**
 * useAutoResumeWorkspace — silently reopens the last workspace on boot when
 * the "Reopen last workspace" setting (`startupBehavior === 'reopen'`) is on,
 * instead of always showing the workspace picker.
 *
 * Boot-order note (the actual bug this hook fixes): `recentWorkspaces` and the
 * settings store both start empty/default and only populate via effects that
 * run AFTER the first render — reading either synchronously at mount (as the
 * unrelated first-run-onboarding check does) sees stale data. This hook takes
 * `settingsHydrated` / `recentWorkspacesLoaded` as explicit inputs and waits
 * for both before deciding, so it never acts on a not-yet-loaded snapshot.
 */
import { useEffect, useRef, useState } from 'react';

export interface AutoResumeRecentWorkspace {
  path: string;
}

export interface UseAutoResumeWorkspaceOptions {
  /**
   * Only an environment that can reopen a workspace without a fresh user
   * gesture is eligible (Tauri; browser directory handles need a picker
   * click per the File System Access API's permission model), and only
   * outside test/demo mode.
   */
  isEligibleEnvironment: boolean;
  settingsHydrated: boolean;
  recentWorkspacesLoaded: boolean;
  startupBehavior: string;
  recentWorkspaces: AutoResumeRecentWorkspace[];
  openWorkspace: (path: string) => Promise<void>;
}

/**
 * Returns true while the auto-resume decision is pending or an open attempt
 * is in flight — callers should suppress the workspace picker for as long as
 * this is true, then fall back to the normal picker once it flips to false
 * (either because reopening isn't applicable, or because the attempt
 * finished, successfully or not).
 */
export function useAutoResumeWorkspace(options: UseAutoResumeWorkspaceOptions): boolean {
  const {
    isEligibleEnvironment,
    settingsHydrated,
    recentWorkspacesLoaded,
    startupBehavior,
    recentWorkspaces,
    openWorkspace,
  } = options;

  // `isEligibleEnvironment` is effectively constant for the app's lifetime
  // (derived from module-level mode flags + a synchronous Tauri check), so
  // it's safe to bake into the initial state instead of reacting to it.
  const [isResuming, setIsResuming] = useState(isEligibleEnvironment);
  // Guards the boot-time decision to exactly one attempt. Set as soon as we
  // have enough data to decide — NOT gated on the decision actually being
  // "yes, resume" — otherwise a later, unrelated recentWorkspaces update
  // (e.g. the user manually opening a workspace after boot decided there was
  // nothing to reopen) would look like "ready to resume" again and silently
  // reopen that just-opened workspace a second time.
  const attempted = useRef(false);

  useEffect(() => {
    if (!isEligibleEnvironment || attempted.current) return;
    // Wait for both boot-time data sources to actually load before deciding —
    // deciding off the pre-hydration snapshot is exactly what breaks this.
    if (!settingsHydrated || !recentWorkspacesLoaded) return;

    attempted.current = true;

    // The whole decision (including the "nothing to reopen" branches) runs
    // inside one async callback so every path settles `isResuming` the same
    // way, through a callback rather than a bare synchronous effect body.
    void (async () => {
      if (startupBehavior !== 'reopen' || recentWorkspaces.length === 0) {
        setIsResuming(false);
        return;
      }
      // recentWorkspaces is kept sorted newest-first (dedupeRecentWorkspaces).
      const target = recentWorkspaces[0]?.path;
      if (target === undefined) {
        setIsResuming(false);
        return;
      }
      try {
        await openWorkspace(target);
      } finally {
        setIsResuming(false);
      }
    })();
  }, [
    isEligibleEnvironment,
    settingsHydrated,
    recentWorkspacesLoaded,
    startupBehavior,
    recentWorkspaces,
    openWorkspace,
  ]);

  return isResuming;
}
