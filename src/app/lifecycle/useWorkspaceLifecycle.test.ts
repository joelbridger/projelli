/**
 * useWorkspaceLifecycle — QA-33 regression coverage for handleOpenRecentProject.
 *
 * Before this fix, a failed "reopen a recent workspace" (used by both the
 * toolbar's Recent Projects menu and the silent boot-time auto-resume) was
 * swallowed into a bare `console.error` — nothing was ever shown to the user.
 * These tests pin down that a failure now (a) surfaces an honest,
 * dismissible message via `workspaceOpenError`, and (b) never throws out of
 * `handleOpenRecentProject`, since useAutoResumeWorkspace relies on that to
 * stay safe.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { createRef } from 'react';

const { createFSBackendMock, initializeMock } = vi.hoisted(() => ({
  createFSBackendMock: vi.fn(),
  initializeMock: vi.fn(),
}));

vi.mock('@/platform/fs/BackendFactory', () => ({
  createFSBackend: createFSBackendMock,
}));

vi.mock('@/platform/fs/WorkspaceService', () => ({
  createWorkspaceService: () => ({ initialize: initializeMock }),
}));

import {
  useWorkspaceLifecycle,
  type UseWorkspaceLifecycleOptions,
} from './useWorkspaceLifecycle';
import { TimeoutError } from '@/lib/withTimeout';
import {
  useAppNavigationStore,
  type AppNavigationSnapshot,
} from '@/platform/state/appNavigationStore';

function makeOptions(): UseWorkspaceLifecycleOptions {
  return {
    workspaceServiceRef: createRef() as never,
    auditServiceRef: {
      current: { hydrate: vi.fn(), getAll: () => [], verifyIntegrity: vi.fn() },
    } as never,
    templatesMarketplaceServiceRef: createRef() as never,
    templatesMetadataReaderRef: createRef() as never,
    setShowWorkspaceSelector: vi.fn(),
    setAuditEntries: vi.fn(),
    setAuditIntegrity: vi.fn(),
    setRootPath: vi.fn(),
    loadTrashMetadata: vi.fn().mockResolvedValue([]),
    setTrashItems: vi.fn(),
    setTrashStats: vi.fn(),
    loadSourceCards: vi.fn().mockResolvedValue([]),
    setSourceCards: vi.fn(),
    loadChatFiles: vi.fn().mockResolvedValue([]),
    setChatFiles: vi.fn(),
    confirm: vi.fn().mockResolvedValue(true),
  };
}

describe('useWorkspaceLifecycle — handleOpenRecentProject (QA-33)', () => {
  beforeEach(() => {
    createFSBackendMock.mockReset();
    initializeMock.mockReset();
    useAppNavigationStore.getState().clear();
  });

  it('surfaces an honest, classified message when the credential service is unavailable', async () => {
    createFSBackendMock.mockRejectedValue({
      kind: 'serviceUnavailable',
      message: 'the OS credential storage service did not respond in time',
    });

    const { result } = renderHook(() => useWorkspaceLifecycle(makeOptions()));
    await act(async () => {
      await result.current.handleOpenRecentProject('/some/workspace');
    });

    expect(result.current.workspaceOpenError).toContain(
      "credential storage service isn't running"
    );
  });

  it('never throws out of handleOpenRecentProject — auto-resume relies on this', async () => {
    createFSBackendMock.mockRejectedValue(new Error('boom'));

    const { result } = renderHook(() => useWorkspaceLifecycle(makeOptions()));
    await expect(
      act(async () => {
        await result.current.handleOpenRecentProject('/some/workspace');
      })
    ).resolves.not.toThrow();

    expect(result.current.workspaceOpenError).toBe('boom');
  });

  it('surfaces a TimeoutError message for a genuinely hung native open', async () => {
    createFSBackendMock.mockRejectedValue(
      new TimeoutError('Opening the workspace', 30_000)
    );

    const { result } = renderHook(() => useWorkspaceLifecycle(makeOptions()));
    await act(async () => {
      await result.current.handleOpenRecentProject('/some/workspace');
    });

    expect(result.current.workspaceOpenError).toBe(
      'Opening the workspace timed out after 30s'
    );
  });

  it('dismissWorkspaceOpenError clears the message', async () => {
    createFSBackendMock.mockRejectedValue(new Error('boom'));

    const { result } = renderHook(() => useWorkspaceLifecycle(makeOptions()));
    await act(async () => {
      await result.current.handleOpenRecentProject('/some/workspace');
    });
    expect(result.current.workspaceOpenError).toBe('boom');

    act(() => {
      result.current.dismissWorkspaceOpenError();
    });
    expect(result.current.workspaceOpenError).toBeNull();
  });

  it('clears Back history when a different workspace is opened', async () => {
    const oldSnapshot: AppNavigationSnapshot = {
      rootPath: '/old-workspace',
      sidebarActiveTab: 'matters',
      activeMatterId: 'old-client',
      clientMapHubId: 'old-client',
      clientMapHubTab: 'overview',
      documentsView: 'browser',
      activeTabPath: null,
      mattersSurfaceMode: 'client-map',
    };
    useAppNavigationStore.getState().push(oldSnapshot);

    const options = makeOptions();
    const service = {
      getRootPath: () => '/new-workspace',
      getBackend: () => null,
      exists: vi.fn().mockResolvedValue(true),
      mkdir: vi.fn().mockResolvedValue(undefined),
      getFileTree: vi.fn().mockResolvedValue([]),
      readFile: vi.fn(),
      readFileBinary: vi.fn(),
    };

    const { result } = renderHook(() => useWorkspaceLifecycle(options));
    await act(async () => {
      await result.current.handleWorkspaceSelected(service as never);
    });

    expect(useAppNavigationStore.getState().stack).toHaveLength(0);
  });
});
