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
 *
 * Two escape-hatch requirements a boot-time silent action must never violate
 * (a post-merge review round caught both were missing from the first cut):
 * - It must never be able to hang forever: `openWorkspace`'s own native setup
 *   is timeout-bounded (see `handleOpenRecentProject` in
 *   `useWorkspaceLifecycle.ts`), so a hung native call (e.g. an unreachable
 *   network share) resolves within a bounded window instead of leaving the
 *   picker suppressed with no way out.
 * - It must never silently attempt to read an encrypted workspace it can't
 *   decrypt: `isWorkspaceVaultLocked` preflights the target, and a locked
 *   vault falls back to the picker (whose own vault-unlock flow then runs
 *   normally) instead of auto-opening straight into failing file reads.
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
  /**
   * The workspace root that the app has committed. Opening a workspace also
   * performs several best-effort loads; they must not keep the app's boot
   * curtain up once the workspace itself is safe to use.
   */
  activeWorkspacePath?: string | null;
  /**
   * Preflight check: does the target workspace have a locked encrypted vault?
   * A locked vault needs the picker's VaultLockedPrompt UI to unlock — silently
   * auto-opening it would boot straight into failing file reads with no way to
   * unlock. Should fail OPEN (resolve `false`) on its own errors/timeouts, same
   * as WorkspaceSelector's equivalent check — this is a UX preflight only, not
   * the security boundary (the vault's own encryption is what actually protects
   * the data either way).
   */
  isWorkspaceVaultLocked: (path: string) => Promise<boolean>;
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
    activeWorkspacePath,
    isWorkspaceVaultLocked,
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
  const resumingTarget = useRef<string | null>(null);

  // `handleWorkspaceSelected` commits the root before it completes optional
  // hydration (activity history, saved tabs, source cards, and similar work).
  // The old code hid the shell until all of that returned. A slow local
  // service then made an already-open workspace look like the CRM vanished.
  // The committed root is the shell's hard prerequisite, so reveal it then.
  useEffect(() => {
    if (
      isResuming &&
      resumingTarget.current !== null &&
      activeWorkspacePath === resumingTarget.current
    ) {
      setIsResuming(false);
    }
  }, [activeWorkspacePath, isResuming]);

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

      resumingTarget.current = target;

      let vaultLocked = false;
      try {
        vaultLocked = await isWorkspaceVaultLocked(target);
      } catch {
        vaultLocked = false; // fail open — preflight-only, not the security boundary
      }
      if (vaultLocked) {
        // Fall back to the picker instead of auto-opening: clicking this same
        // recent workspace there runs the vault-aware open path and shows the
        // unlock prompt normally.
        setIsResuming(false);
        return;
      }

      try {
        await openWorkspace(target);
      } finally {
        resumingTarget.current = null;
        setIsResuming(false);
      }
    })();
  }, [
    isEligibleEnvironment,
    settingsHydrated,
    recentWorkspacesLoaded,
    startupBehavior,
    recentWorkspaces,
    isWorkspaceVaultLocked,
    openWorkspace,
  ]);

  return isResuming;
}
