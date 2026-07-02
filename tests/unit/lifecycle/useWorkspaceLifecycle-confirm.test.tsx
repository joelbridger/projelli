/**
 * WebView2 dialog fix — the unsaved-changes guard in handleWorkspaceSelected.
 *
 * Native window.confirm is dead in the Tauri Windows build (renders nothing AND
 * returns a truthy object), so the old guard would proceed and DROP unsaved work
 * on a workspace switch. The guard now awaits the in-app confirm threaded from
 * App. These tests lock the semantics: when a flush leaves dirty tabs, the
 * switch aborts iff the user cancels, and proceeds iff they confirm.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useRef, type MutableRefObject } from 'react';

// Mock the flush module so a dirty tab REMAINS after flushAllDirtyTabs (the
// disk/permission-failure case the guard exists for). Keep setActiveWorkspaceService
// a no-op so the real handler wiring is otherwise unchanged.
vi.mock('@/app/fileOps/flushDirtyTabs', () => ({
  flushAllDirtyTabs: vi.fn(async () => {}),
  setActiveWorkspaceService: vi.fn(),
}));
// Avoid any real FS write when closing the outgoing workspace scope.
vi.mock('@/platform/mcp/mcpSessionScope', () => ({
  writeDenyAllMcpSessionScopeFile: vi.fn(async () => {}),
}));

import { useWorkspaceLifecycle } from '@/app/lifecycle/useWorkspaceLifecycle';
import { useWorkspaceStore } from '@/platform/fs/workspaceStore';
import { useEditorStore } from '@/platform/state/editorStore';
import { AuditService } from '@/platform/audit/AuditService';
import type { WorkspaceService } from '@/platform/fs/WorkspaceService';

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

function renderLifecycle(confirm: (msg: string, opts?: unknown) => Promise<boolean>) {
  let refHolder!: MutableRefObject<WorkspaceService | null>;
  const setRootPath = vi.fn((p: string) => useWorkspaceStore.getState().setRootPath(p));
  const utils = renderHook(() => {
    const workspaceServiceRef = useRef<WorkspaceService | null>(null);
    refHolder = workspaceServiceRef;
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
      setRootPath,
      loadTrashMetadata: vi.fn(async () => []),
      setTrashItems: vi.fn(),
      setTrashStats: vi.fn(),
      loadSourceCards: vi.fn(async () => []),
      setSourceCards: vi.fn(),
      loadChatFiles: vi.fn(async () => []),
      setChatFiles: vi.fn(),
      confirm: confirm as never,
    });
  });
  return { ...utils, refHolder, setRootPath };
}

beforeEach(() => {
  localStorage.clear();
  useWorkspaceStore.setState({ recentWorkspaces: [], rootPath: '/old' });
  // A dirty tab that the mocked flush leaves unsaved → guard must fire.
  useEditorStore.setState({
    openTabs: [{ path: '/old/brief.docx', name: 'brief.docx', content: 'x', isDirty: true }],
  } as never);
});

describe('handleWorkspaceSelected — in-app unsaved-changes guard', () => {
  it('ABORTS the switch (keeps current workspace) when the user cancels', async () => {
    const confirm = vi.fn(async (_msg: string, _opts?: unknown) => false); // user picks "Keep editing"
    const { result, refHolder, setRootPath } = renderLifecycle(confirm);
    refHolder.current = fakeService('/old'); // an outgoing workspace exists

    await act(async () => {
      await result.current.handleWorkspaceSelected(fakeService('/new'));
    });

    // The guard ran with the destructive framing...
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm.mock.calls[0]![1]).toMatchObject({ variant: 'destructive' });
    // ...and because the user cancelled, the switch did NOT proceed.
    expect(setRootPath).not.toHaveBeenCalled();
    expect(refHolder.current!.getRootPath()).toBe('/old');
  });

  it('PROCEEDS with the switch when the user confirms', async () => {
    const confirm = vi.fn(async () => true); // user picks "Switch anyway"
    const { result, refHolder, setRootPath } = renderLifecycle(confirm);
    refHolder.current = fakeService('/old');

    await act(async () => {
      await result.current.handleWorkspaceSelected(fakeService('/new'));
    });

    expect(confirm).toHaveBeenCalledTimes(1);
    // The switch went through to the new workspace.
    expect(setRootPath).toHaveBeenCalledWith('/new');
    expect(refHolder.current!.getRootPath()).toBe('/new');
  });
});
