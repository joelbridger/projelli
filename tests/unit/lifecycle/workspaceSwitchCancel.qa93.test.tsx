/**
 * QA-93 round 3 (Codex F2) — a CANCELED workspace switch must leave the app
 * fully on the OLD workspace.
 *
 * The failure shape: the Workspace Selector used to commit the new root
 * (setRootPath → which reloads the per-workspace matter/client-map stores) and
 * only THEN call the lifecycle handler, whose unsaved-changes guard can still
 * abort the switch. An abort then stranded the app: UI + service on workspace
 * A, client stores (and root) on workspace B — whole-practice Ask counting the
 * wrong book. The root must be committed in exactly ONE place
 * (handleWorkspaceSelected), after the switch is irrevocable.
 *
 * Covered entry paths (all three from round 1): Open Existing (Workspace
 * Selector), Recent Projects menu (handleOpenRecentProject), and boot restore
 * (useAutoResumeWorkspace → handleOpenRecentProject).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import { renderHook } from '@testing-library/react';
import { useRef, type MutableRefObject } from 'react';

vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }));
vi.mock('@/platform/utils/tauri-commands', () => ({
  migrateWorkspaceDataDir: vi.fn().mockResolvedValue(null),
}));
vi.mock('@/platform/firm/vault/vaultClient', () => ({
  vaultStatus: vi.fn().mockResolvedValue({ enabled: false, locked: false, hasEscrow: false, vaultId: null }),
}));
vi.mock('@/platform/fs/BackendFactory', () => ({
  createFSBackend: vi.fn(async () => ({})),
  isTauriEnvironment: () => true,
}));
vi.mock('@/platform/fs/WorkspaceService', () => ({
  createWorkspaceService: () => {
    let root = '';
    return {
      initialize: vi.fn(async (_backend: unknown, path: string) => {
        root = path;
        return { rootPath: path, name: path };
      }),
      getRootPath: () => root,
      getBackend: () => null,
      exists: vi.fn(async () => true),
      mkdir: vi.fn(async () => {}),
      getFileTree: vi.fn(async () => []),
      readFile: vi.fn(async () => ''),
      readFileBinary: vi.fn(async () => new Uint8Array()),
    };
  },
}));
// The unsaved-changes guard fires when a dirty tab survives the flush — mock
// the flush to leave the store's dirty tab in place (the disk-failure case).
vi.mock('@/app/fileOps/flushDirtyTabs', () => ({
  flushAllDirtyTabs: vi.fn(async () => [] as string[]),
  setActiveWorkspaceService: vi.fn(),
}));
vi.mock('@/platform/mcp/mcpSessionScope', () => ({
  writeDenyAllMcpSessionScopeFile: vi.fn(async () => {}),
}));

import { WorkspaceSelector } from '@/features/documents/workspace/WorkspaceSelector';
import { useWorkspaceLifecycle } from '@/app/lifecycle/useWorkspaceLifecycle';
import { useAutoResumeWorkspace } from '@/app/lifecycle/useAutoResumeWorkspace';
import { useWorkspaceStore } from '@/platform/fs/workspaceStore';
import { useEditorStore } from '@/platform/state/editorStore';
import { useMatterStore, getMatters, clearPendingMatterMigrationAudit } from '@/platform/matter/matterStore';
import { setActiveWorkspaceScopeRoot } from '@/platform/state/workspaceScope';
import type { WorkspaceService } from '@/platform/fs/WorkspaceService';
import type { AuditService } from '@/platform/audit/AuditService';

const baseMatter = {
  name: 'C', client: 'C', mailFolderPaths: [], crmHouseholdKeys: [], onedriveFolderKeys: [],
  boxFolderKeys: [], esignKeys: [], jotformKeys: [], sharefileFolderKeys: [], meetingKeys: [],
  zocksKeys: [], addeparKeys: [], privileged: false, mcpAccessGranted: false, shared: false,
  createdAt: '2026-01-01T00:00:00Z',
};

/** Legacy global data with one client in each of two workspaces. */
function seedLegacyMatters(): void {
  localStorage.setItem('lantern:matters', JSON.stringify({
    state: {
      matters: [
        { ...baseMatter, id: 'a1', folderPaths: ['/wsA/Acme'] },
        { ...baseMatter, id: 'b1', folderPaths: ['/wsB/Gamma'] },
      ],
      activeMatterId: null,
    },
    version: 10,
  }));
}

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

/** Render the real lifecycle hook with an OPEN workspace A and a dirty tab the
 *  mocked flush leaves unsaved, so the switch guard fires. `confirmAnswer`
 *  decides whether the user proceeds ("Switch anyway") or cancels. */
function renderLifecycleOnWsA(confirmAnswer: boolean) {
  let refHolder!: MutableRefObject<WorkspaceService | null>;
  const setShowWorkspaceSelector = vi.fn();
  const utils = renderHook(() => {
    const workspaceServiceRef = useRef<WorkspaceService | null>(null);
    refHolder = workspaceServiceRef;
    const auditServiceRef = useRef({ hydrate: vi.fn(), getAll: () => [], verifyIntegrity: vi.fn() } as unknown as AuditService);
    return useWorkspaceLifecycle({
      workspaceServiceRef,
      auditServiceRef,
      templatesMarketplaceServiceRef: useRef(null),
      templatesMetadataReaderRef: useRef(null),
      setShowWorkspaceSelector,
      setAuditEntries: vi.fn(),
      setAuditIntegrity: vi.fn(),
      setRootPath: (p: string) => { useWorkspaceStore.getState().setRootPath(p); },
      loadTrashMetadata: vi.fn(async () => []),
      setTrashItems: vi.fn(),
      setTrashStats: vi.fn(),
      loadSourceCards: vi.fn(async () => []),
      setSourceCards: vi.fn(),
      loadChatFiles: vi.fn(async () => []),
      setChatFiles: vi.fn(),
      confirm: vi.fn(async () => confirmAnswer) as never,
    });
  });
  refHolder.current = fakeService('/wsA');
  return { ...utils, refHolder, setShowWorkspaceSelector };
}

beforeEach(() => {
  localStorage.clear();
  setActiveWorkspaceScopeRoot(null);
  clearPendingMatterMigrationAudit();
  // Reset the store BEFORE seeding: setState runs the persist middleware, which
  // writes the (empty) state to the current scope's key — seeding first would
  // be clobbered by that write.
  useMatterStore.setState({ matters: [], activeMatterId: null, snapshots: {}, cache: {}, statusByMatterId: {} });
  seedLegacyMatters();
  // Workspace A is open, with a dirty tab that the mocked flush leaves unsaved.
  useWorkspaceStore.setState({
    rootPath: '/wsA',
    fileTree: [{ name: 'sentinel-A', path: '/wsA/sentinel-A', type: 'file' }],
    recentWorkspaces: [
      { path: '/wsA', name: 'wsA', lastOpened: new Date() },
      { path: '/wsB', name: 'wsB', lastOpened: new Date() },
    ],
  } as never);
  useEditorStore.setState({
    openTabs: [{ path: '/wsA/brief.docx', name: 'brief.docx', content: 'x', isDirty: true }],
  } as never);
});

afterEach(() => {
  setActiveWorkspaceScopeRoot(null);
  clearPendingMatterMigrationAudit();
  useWorkspaceStore.setState({ rootPath: null } as never);
});

describe('QA-93 round 3 — canceled switch leaves root + client stores on the OLD workspace', () => {
  it('OPEN EXISTING (Workspace Selector): nothing is committed before the handler decides; an aborted handler leaves everything on A', async () => {
    // The handler reports the abort — the selector must not have committed
    // anything beforehand, and must not commit anything after.
    const onWorkspaceSelected = vi.fn(async () => false);
    render(<WorkspaceSelector open onWorkspaceSelected={onWorkspaceSelected} />);

    await act(async () => {
      screen.getByTestId('recent-workspaces-toggle').click();
    });
    const rows = screen.getAllByTestId('recent-workspace-row');
    // Row order matches the seeded recents: [0]=/wsA, [1]=/wsB.
    await act(async () => {
      rows[1]!.click();
      // Let the async open settle.
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    });

    await waitFor(() => expect(onWorkspaceSelected).toHaveBeenCalledTimes(1));
    // The app is still fully on workspace A: root, file tree, client stores.
    expect(useWorkspaceStore.getState().rootPath).toBe('/wsA');
    expect(useWorkspaceStore.getState().fileTree.map((n: { name: string }) => n.name)).toEqual(['sentinel-A']);
  });

  it('RECENT PROJECTS menu (handleOpenRecentProject): user cancels the unsaved-changes guard → root and matters stay on A', async () => {
    const { result, unmount } = renderLifecycleOnWsA(false /* user picks "Keep editing" */);
    // The lifecycle subscription mounted with A open → A's client is visible.
    expect(getMatters().map((m) => m.id)).toEqual(['a1']);

    await act(async () => {
      await result.current.handleOpenRecentProject('/wsB');
    });

    // Still on A, stores never moved to B, no error surfaced (a cancel is not
    // a failure), and the selector was never force-closed.
    expect(useWorkspaceStore.getState().rootPath).toBe('/wsA');
    expect(getMatters().map((m) => m.id)).toEqual(['a1']);
    expect(result.current.workspaceOpenError).toBeNull();
    unmount();
  });

  it('RECENT PROJECTS menu: the same switch COMMITS when the user proceeds (control case)', async () => {
    const { result, unmount } = renderLifecycleOnWsA(true /* user picks "Switch anyway" */);
    expect(getMatters().map((m) => m.id)).toEqual(['a1']);

    await act(async () => {
      await result.current.handleOpenRecentProject('/wsB');
    });

    expect(useWorkspaceStore.getState().rootPath).toBe('/wsB');
    expect(getMatters().map((m) => m.id)).toEqual(['b1']);
    unmount();
  });

  it('BOOT RESTORE (useAutoResumeWorkspace → handleOpenRecentProject): an aborted reopen strands nothing and the resume settles', async () => {
    let refHolder!: MutableRefObject<WorkspaceService | null>;
    const { result, unmount } = renderHook(() => {
      const workspaceServiceRef = useRef<WorkspaceService | null>(null);
      refHolder = workspaceServiceRef;
      const auditServiceRef = useRef({ hydrate: vi.fn(), getAll: () => [], verifyIntegrity: vi.fn() } as unknown as AuditService);
      const lifecycle = useWorkspaceLifecycle({
        workspaceServiceRef,
        auditServiceRef,
        templatesMarketplaceServiceRef: useRef(null),
        templatesMetadataReaderRef: useRef(null),
        setShowWorkspaceSelector: vi.fn(),
        setAuditEntries: vi.fn(),
        setAuditIntegrity: vi.fn(),
        setRootPath: (p: string) => { useWorkspaceStore.getState().setRootPath(p); },
        loadTrashMetadata: vi.fn(async () => []),
        setTrashItems: vi.fn(),
        setTrashStats: vi.fn(),
        loadSourceCards: vi.fn(async () => []),
        setSourceCards: vi.fn(),
        loadChatFiles: vi.fn(async () => []),
        setChatFiles: vi.fn(),
        confirm: vi.fn(async () => false) as never, // user cancels the guard
      });
      const isResuming = useAutoResumeWorkspace({
        isEligibleEnvironment: true,
        settingsHydrated: true,
        recentWorkspacesLoaded: true,
        startupBehavior: 'reopen',
        recentWorkspaces: [{ path: '/wsB' }],
        isWorkspaceVaultLocked: vi.fn(async () => false),
        openWorkspace: lifecycle.handleOpenRecentProject,
      });
      return { lifecycle, isResuming };
    });
    refHolder.current = fakeService('/wsA');

    // The resume attempt settles (never hangs on the abort)…
    await waitFor(() => expect(result.current.isResuming).toBe(false));
    // …and the aborted reopen left root + client stores on A.
    expect(useWorkspaceStore.getState().rootPath).toBe('/wsA');
    expect(getMatters().map((m) => m.id)).toEqual(['a1']);
    unmount();
  });
});
