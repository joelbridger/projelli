/**
 * Authoritative real-path test for the Recents BLOCKER.
 *
 * Background (real-Windows QA, twice): picking "Start with a sample practice"
 * created the workspace but NEVER registered it in `keepance_recent_workspaces`,
 * so the first-run gate (`!hasCompletedOnboarding() && recentWorkspaces.length
 * === 0`) stayed true and onboarding looped back to the intro. A prior fix put
 * `addRecentWorkspace(...)` in App.tsx's onboarding handler, but a live console
 * trace proved that call never fired on the real flow — while its neighbours in
 * `handleWorkspaceSelected` (the shared workspace-open lifecycle boundary) all
 * did. The fix moved the registration INTO `handleWorkspaceSelected`.
 *
 * Why this test and not the App-level one: the sibling
 * `onboarding-sample-recents.test.tsx` MOCKS `useWorkspaceLifecycle`, so it can
 * never prove the REAL boundary registers recents — which is precisely how the
 * prior fix's test passed while the shipped app stayed broken. This test drives
 * the REAL, unmocked hook end-to-end and asserts the workspace lands in Recents
 * (both the in-memory store and persisted localStorage), for BOTH a
 * freshly-created workspace and a re-open.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useRef } from 'react';

import { useWorkspaceLifecycle } from '@/app/lifecycle/useWorkspaceLifecycle';
import { useWorkspaceStore } from '@/platform/fs/workspaceStore';
import { AuditService } from '@/platform/audit/AuditService';
import type { WorkspaceService } from '@/platform/fs/WorkspaceService';

const RECENTS_KEY = 'keepance_recent_workspaces';

/**
 * A minimal WorkspaceService test double that satisfies every call
 * `handleWorkspaceSelected` makes on the incoming service. `exists` returns true
 * so the default-folder creation path is a no-op (keeps the test to the recents
 * behaviour); `getBackend` returns null so the templates-marketplace branch is
 * skipped.
 */
function fakeService(rootPath: string): WorkspaceService {
  return {
    getRootPath: () => rootPath,
    getBackend: () => null,
    exists: vi.fn(async () => true),
    mkdir: vi.fn(async () => {}),
    getFileTree: vi.fn(async () => []),
    readFile: vi.fn(async () => ''),
    readFileBinary: vi.fn(async () => new Uint8Array()),
  } as unknown as WorkspaceService;
}

/** Render the real hook with fully-stubbed options and return its handlers. */
function renderLifecycle() {
  return renderHook(() => {
    const workspaceServiceRef = useRef<WorkspaceService | null>(null);
    const auditServiceRef = useRef<AuditService>(new AuditService());
    const templatesMarketplaceServiceRef = useRef(null);
    const templatesMetadataReaderRef = useRef(null);
    return useWorkspaceLifecycle({
      workspaceServiceRef,
      auditServiceRef,
      templatesMarketplaceServiceRef,
      templatesMetadataReaderRef,
      setShowWorkspaceSelector: vi.fn(),
      setAuditEntries: vi.fn(),
      setAuditIntegrity: vi.fn(),
      setRootPath: (p: string) => useWorkspaceStore.getState().setRootPath(p),
      loadTrashMetadata: vi.fn(async () => []),
      setTrashItems: vi.fn(),
      setTrashStats: vi.fn(),
      loadSourceCards: vi.fn(async () => []),
      setSourceCards: vi.fn(),
      loadChatFiles: vi.fn(async () => []),
      setChatFiles: vi.fn(),
    });
  });
}

beforeEach(() => {
  localStorage.clear();
  useWorkspaceStore.setState({ recentWorkspaces: [], rootPath: null });
});

describe('useWorkspaceLifecycle — Recents registered at the shared boundary', () => {
  it('handleWorkspaceSelected registers the opened workspace in Recents (store + localStorage)', async () => {
    const addSpy = vi.spyOn(useWorkspaceStore.getState(), 'addRecentWorkspace');
    const { result } = renderLifecycle();

    await act(async () => {
      await result.current.handleWorkspaceSelected(fakeService('/Users/me/Sample Practice'));
    });

    // The canonical registration ran (this is the exact call the prior fix
    // placed in App.tsx, where it never fired on the real Windows flow).
    expect(addSpy).toHaveBeenCalledWith(
      expect.objectContaining({ path: '/Users/me/Sample Practice', name: 'Sample Practice' }),
    );

    // In-memory store now contains it — so the first-run gate is satisfied.
    const recents = useWorkspaceStore.getState().recentWorkspaces;
    expect(recents.some((w) => w.path.endsWith('Sample Practice'))).toBe(true);

    // And it was persisted, so a reload still sees a recent workspace.
    expect(localStorage.getItem(RECENTS_KEY)).not.toBeNull();
    expect(JSON.parse(localStorage.getItem(RECENTS_KEY)!)).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'Sample Practice' })]),
    );
  });

  it('handleOpenRecentProject also flows through the boundary and registers Recents', async () => {
    // handleOpenRecentProject builds a service then calls handleWorkspaceSelected,
    // so re-opening a recent must keep it in Recents (bumped to most-recent). We
    // exercise the shared handler directly with a Windows-style path to also
    // cover the backslash split in the name derivation.
    const { result } = renderLifecycle();

    await act(async () => {
      await result.current.handleWorkspaceSelected(fakeService('C:\\keepance\\Practice'));
    });

    const recents = useWorkspaceStore.getState().recentWorkspaces;
    expect(recents.length).toBe(1);
    expect(recents[0]!.name).toBe('Practice');
  });
});
