/**
 * QA-93 stage B — the workspace-switch choke-point reloads per-workspace stores.
 *
 * `useWorkspaceLifecycle` subscribes to the workspace root and swaps the matter +
 * client-map stores whenever it changes. This proves that driving `setRootPath`
 * (the ONE action every open path — Open Existing, Recent Projects, boot
 * auto-resume — funnels through) actually swaps the visible clients, end to end
 * through the real subscription + rehydrate + one-time migration.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { createRef } from 'react';

import { useWorkspaceLifecycle, type UseWorkspaceLifecycleOptions } from './useWorkspaceLifecycle';
import { useWorkspaceStore } from '@/platform/fs/workspaceStore';
import { useMatterStore, getMatters } from '@/platform/matter/matterStore';
import { setActiveWorkspaceScopeRoot } from '@/platform/state/workspaceScope';

function makeOptions(): UseWorkspaceLifecycleOptions {
  return {
    workspaceServiceRef: createRef() as never,
    auditServiceRef: { current: { hydrate: vi.fn(), getAll: () => [], verifyIntegrity: vi.fn() } } as never,
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

const baseMatter = {
  name: 'C', client: 'C', mailFolderPaths: [], crmHouseholdKeys: [], onedriveFolderKeys: [],
  boxFolderKeys: [], esignKeys: [], jotformKeys: [], sharefileFolderKeys: [], meetingKeys: [],
  zocksKeys: [], addeparKeys: [], privileged: false, mcpAccessGranted: false, shared: false,
  createdAt: '2026-01-01T00:00:00Z',
};

beforeEach(() => {
  localStorage.clear();
  setActiveWorkspaceScopeRoot(null);
  useWorkspaceStore.setState({ rootPath: null });
  useMatterStore.setState({ matters: [], activeMatterId: null, snapshots: {}, cache: {}, statusByMatterId: {} });
});
afterEach(() => {
  setActiveWorkspaceScopeRoot(null);
  useWorkspaceStore.setState({ rootPath: null });
});

describe('QA-93 stage B — switching the workspace root swaps the visible matters', () => {
  it('driving setRootPath through the lifecycle subscription reloads matters for that workspace', () => {
    // Legacy global data with a matter in each of two workspaces.
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

    const { unmount } = renderHook(() => useWorkspaceLifecycle(makeOptions()));

    // Open workspace A — only A's client is visible.
    act(() => { useWorkspaceStore.getState().setRootPath('/wsA'); });
    expect(getMatters().map((m) => m.id)).toEqual(['a1']);

    // Switch to workspace B — the client list swaps, no bleed from A.
    act(() => { useWorkspaceStore.getState().setRootPath('/wsB'); });
    expect(getMatters().map((m) => m.id)).toEqual(['b1']);

    // Back to A — A's client again.
    act(() => { useWorkspaceStore.getState().setRootPath('/wsA'); });
    expect(getMatters().map((m) => m.id)).toEqual(['a1']);

    unmount();
  });

  it('a matter created in one workspace never appears in another', () => {
    const { unmount } = renderHook(() => useWorkspaceLifecycle(makeOptions()));

    act(() => { useWorkspaceStore.getState().setRootPath('/wsA'); });
    act(() => { useMatterStore.getState().createMatter({ name: 'Acme', client: 'Acme', folderPaths: ['/wsA/Acme'] }); });
    expect(getMatters()).toHaveLength(1);

    act(() => { useWorkspaceStore.getState().setRootPath('/wsB'); });
    expect(getMatters()).toEqual([]);

    unmount();
  });
});
