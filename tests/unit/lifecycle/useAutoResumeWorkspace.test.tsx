/**
 * Regression test for the boot-order bug where "Reopen last workspace" was
 * ignored and the app always landed on the workspace picker.
 *
 * Root cause: nothing in App.tsx ever read the `startupBehavior` setting to
 * decide boot behavior — `showWorkspaceSelector` always started `true` and
 * nothing flipped it off for a returning user. useAutoResumeWorkspace is the
 * fix's seam: it decides, exactly once per boot, whether to silently reopen
 * the most recent workspace instead of showing the picker — and it must wait
 * for the settings store and the recent-workspaces list to actually finish
 * loading before deciding, since both start empty/default and only populate
 * via effects that run after the first render.
 *
 * A post-merge review round then found two safety gaps in the first cut:
 * (P1) a hung `openWorkspace` left the picker suppressed forever with no
 * escape — fixed at the caller (`handleOpenRecentProject` in
 * `useWorkspaceLifecycle.ts`, covered by its own test file) by timeout-
 * bounding the native setup step, so this hook's contract just needs
 * `openWorkspace` to eventually settle, which it now always does; (P2) a
 * locked encrypted vault was silently opened instead of showing the unlock
 * prompt — fixed here via the injected `isWorkspaceVaultLocked` preflight,
 * tested below.
 */
import { describe, it, expect, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { useAutoResumeWorkspace } from '@/app/lifecycle/useAutoResumeWorkspace';

/** Default vault preflight for tests that don't care about vault state. */
const notLocked = () => vi.fn(async () => false);

describe('useAutoResumeWorkspace', () => {
  it('reopens the most recent workspace when the setting is on, once boot data has loaded', async () => {
    const openWorkspace = vi.fn(async () => {});

    const { result } = renderHook(() =>
      useAutoResumeWorkspace({
        isEligibleEnvironment: true,
        settingsHydrated: true,
        recentWorkspacesLoaded: true,
        startupBehavior: 'reopen',
        recentWorkspaces: [{ path: '/Users/me/Practice' }, { path: '/Users/me/Old' }],
        isWorkspaceVaultLocked: notLocked(),
        openWorkspace,
      }),
    );

    // Resuming starts true and stays true until the open attempt settles.
    expect(result.current).toBe(true);
    await waitFor(() => expect(openWorkspace).toHaveBeenCalledWith('/Users/me/Practice'));

    await waitFor(() => expect(result.current).toBe(false));
  });

  it('reveals the shell as soon as the target workspace is committed, without waiting for optional hydration', async () => {
    let finishOpen: (() => void) | undefined;
    const openWorkspace = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishOpen = resolve;
        }),
    );

    const { result, rerender } = renderHook(
      ({ activeWorkspacePath }: { activeWorkspacePath: string | null }) =>
        useAutoResumeWorkspace({
          isEligibleEnvironment: true,
          settingsHydrated: true,
          recentWorkspacesLoaded: true,
          startupBehavior: 'reopen',
          recentWorkspaces: [{ path: '/Users/me/Practice' }],
          activeWorkspacePath,
          isWorkspaceVaultLocked: notLocked(),
          openWorkspace,
        }),
      { initialProps: { activeWorkspacePath: null } },
    );

    await waitFor(() => expect(openWorkspace).toHaveBeenCalledWith('/Users/me/Practice'));
    expect(result.current).toBe(true);

    rerender({ activeWorkspacePath: '/Users/me/Practice' });
    await waitFor(() => expect(result.current).toBe(false));

    finishOpen?.();
  });

  it('never auto-resumes when the setting is "selector"', () => {
    const openWorkspace = vi.fn(async () => {});

    const { result } = renderHook(() =>
      useAutoResumeWorkspace({
        isEligibleEnvironment: true,
        settingsHydrated: true,
        recentWorkspacesLoaded: true,
        startupBehavior: 'selector',
        recentWorkspaces: [{ path: '/Users/me/Practice' }],
        isWorkspaceVaultLocked: notLocked(),
        openWorkspace,
      }),
    );

    expect(result.current).toBe(false);
    expect(openWorkspace).not.toHaveBeenCalled();
  });

  it('falls back to the picker when there is nothing to reopen', () => {
    const openWorkspace = vi.fn(async () => {});

    const { result } = renderHook(() =>
      useAutoResumeWorkspace({
        isEligibleEnvironment: true,
        settingsHydrated: true,
        recentWorkspacesLoaded: true,
        startupBehavior: 'reopen',
        recentWorkspaces: [],
        isWorkspaceVaultLocked: notLocked(),
        openWorkspace,
      }),
    );

    expect(result.current).toBe(false);
    expect(openWorkspace).not.toHaveBeenCalled();
  });

  it('never auto-resumes outside an eligible environment (browser/test/demo)', () => {
    const openWorkspace = vi.fn(async () => {});

    const { result } = renderHook(() =>
      useAutoResumeWorkspace({
        isEligibleEnvironment: false,
        settingsHydrated: true,
        recentWorkspacesLoaded: true,
        startupBehavior: 'reopen',
        recentWorkspaces: [{ path: '/Users/me/Practice' }],
        isWorkspaceVaultLocked: notLocked(),
        openWorkspace,
      }),
    );

    expect(result.current).toBe(false);
    expect(openWorkspace).not.toHaveBeenCalled();
  });

  it(
    'THE REGRESSION: waits for settings + recents to finish loading instead of ' +
      'deciding off the pre-hydration snapshot (settings not yet hydrated, ' +
      'recents not yet loaded — both start empty/default on boot)',
    async () => {
      const openWorkspace = vi.fn(async () => {});

      // Simulate the real boot sequence: both hydration flags start false, and
      // React flips them on in separate updates once their respective stores
      // finish loading — exactly like useSettingsHydrated()/loadRecentWorkspaces()
      // do in the real app relative to App()'s first render.
      const { result } = renderHook(() => {
        const [settingsHydrated, setSettingsHydrated] = useState(false);
        const [recentWorkspacesLoaded, setRecentWorkspacesLoaded] = useState(false);
        const isResuming = useAutoResumeWorkspace({
          isEligibleEnvironment: true,
          settingsHydrated,
          recentWorkspacesLoaded,
          startupBehavior: 'reopen',
          recentWorkspaces: recentWorkspacesLoaded ? [{ path: '/Users/me/Practice' }] : [],
          isWorkspaceVaultLocked: notLocked(),
          openWorkspace,
        });
        return { isResuming, setSettingsHydrated, setRecentWorkspacesLoaded };
      });

      // Before either store has loaded, the hook must not have given up and
      // revealed the picker yet — and it must not have acted on empty data.
      expect(result.current.isResuming).toBe(true);
      expect(openWorkspace).not.toHaveBeenCalled();

      act(() => result.current.setSettingsHydrated(true));
      // Only one of the two sources loaded — still must not decide yet.
      expect(result.current.isResuming).toBe(true);
      expect(openWorkspace).not.toHaveBeenCalled();

      act(() => result.current.setRecentWorkspacesLoaded(true));

      // Now that both sources are loaded, it acts on the real data.
      await waitFor(() => expect(openWorkspace).toHaveBeenCalledWith('/Users/me/Practice'));
      await waitFor(() => expect(result.current.isResuming).toBe(false));
    },
  );

  it('only attempts the resume once, even if inputs change afterward', async () => {
    const openWorkspace = vi.fn(async () => {});

    const { result, rerender } = renderHook(
      (props: { recentWorkspaces: Array<{ path: string }> }) =>
        useAutoResumeWorkspace({
          isEligibleEnvironment: true,
          settingsHydrated: true,
          recentWorkspacesLoaded: true,
          startupBehavior: 'reopen',
          recentWorkspaces: props.recentWorkspaces,
          isWorkspaceVaultLocked: notLocked(),
          openWorkspace,
        }),
      { initialProps: { recentWorkspaces: [{ path: '/Users/me/Practice' }] } },
    );

    await waitFor(() => expect(result.current).toBe(false));
    expect(openWorkspace).toHaveBeenCalledTimes(1);

    // A later change to recentWorkspaces (e.g. the user opens another
    // workspace mid-session) must not trigger a second silent reopen.
    rerender({ recentWorkspaces: [{ path: '/Users/me/Another' }] });
    expect(openWorkspace).toHaveBeenCalledTimes(1);
  });

  it(
    'CODEX REVIEW FINDING: does not silently reopen a workspace the user just ' +
      'opened by hand after boot found nothing to resume',
    async () => {
      const openWorkspace = vi.fn(async () => {});

      // Boot with an empty recents list — nothing to resume, so the hook
      // should settle "no" once and never revisit that decision.
      const { result, rerender } = renderHook(
        (props: { recentWorkspaces: Array<{ path: string }> }) =>
          useAutoResumeWorkspace({
            isEligibleEnvironment: true,
            settingsHydrated: true,
            recentWorkspacesLoaded: true,
            startupBehavior: 'reopen',
            recentWorkspaces: props.recentWorkspaces,
            isWorkspaceVaultLocked: notLocked(),
            openWorkspace,
          }),
        { initialProps: { recentWorkspaces: [] as Array<{ path: string }> } },
      );

      expect(result.current).toBe(false);
      expect(openWorkspace).not.toHaveBeenCalled();

      // User manually opens a workspace from the picker — this is exactly
      // what feeds a fresh entry into recentWorkspaces post-boot.
      rerender({ recentWorkspaces: [{ path: '/Users/me/Just Opened' }] });

      // Must NOT be silently reopened a second time, and the picker must not
      // reappear (isResuming flipping back to true would hide the just-opened
      // workspace behind the auto-resume loading screen).
      expect(openWorkspace).not.toHaveBeenCalled();
      expect(result.current).toBe(false);
    },
  );

  it(
    'REVIEW FINDING (P2): a locked encrypted vault falls back to the picker ' +
      'instead of being silently opened',
    async () => {
      const openWorkspace = vi.fn(async () => {});
      const isWorkspaceVaultLocked = vi.fn(async () => true);

      const { result } = renderHook(() =>
        useAutoResumeWorkspace({
          isEligibleEnvironment: true,
          settingsHydrated: true,
          recentWorkspacesLoaded: true,
          startupBehavior: 'reopen',
          recentWorkspaces: [{ path: '/Users/me/Locked Practice' }],
          isWorkspaceVaultLocked,
          openWorkspace,
        }),
      );

      await waitFor(() => expect(isWorkspaceVaultLocked).toHaveBeenCalledWith('/Users/me/Locked Practice'));
      // The picker must reappear (isResuming false) so its own VaultLockedPrompt
      // flow can run — and the workspace must never have been silently opened.
      await waitFor(() => expect(result.current).toBe(false));
      expect(openWorkspace).not.toHaveBeenCalled();
    },
  );

  it(
    'REVIEW FINDING (P2): a failed/timed-out vault preflight fails OPEN and ' +
      'still resumes (preflight-only, not the security boundary)',
    async () => {
      const openWorkspace = vi.fn(async () => {});
      const isWorkspaceVaultLocked = vi.fn(async () => {
        throw new Error('vault_status command unavailable');
      });

      const { result } = renderHook(() =>
        useAutoResumeWorkspace({
          isEligibleEnvironment: true,
          settingsHydrated: true,
          recentWorkspacesLoaded: true,
          startupBehavior: 'reopen',
          recentWorkspaces: [{ path: '/Users/me/Practice' }],
          isWorkspaceVaultLocked,
          openWorkspace,
        }),
      );

      await waitFor(() => expect(openWorkspace).toHaveBeenCalledWith('/Users/me/Practice'));
      await waitFor(() => expect(result.current).toBe(false));
    },
  );
});
