import { describe, expect, it, vi } from 'vitest';

import { openRunArtifactFromWorkflows } from '@/app/shell/openRunArtifactFromWorkflows';

const matterState = {
  matters: [
    {
      id: 'client-1',
      name: 'Alice',
      client: 'Alice',
      folderPaths: ['/workspace/Clients/Alice'],
      createdAt: '2026-07-06T00:00:00.000Z',
    },
  ],
  setActiveMatter: vi.fn(),
  setClientMapHubId: vi.fn(),
  setClientMapHubTab: vi.fn(),
};

vi.mock('@/platform/matter/matterStore', () => ({
  useMatterStore: {
    getState: () => matterState,
    subscribe: () => () => {},
  },
}));

describe('AppSurfaceRouter workflow artifact opening', () => {
  it('stays on Workflows when a recent run artifact cannot be opened', async () => {
    const setSidebarActiveTab = vi.fn();

    const opened = await openRunArtifactFromWorkflows({
      path: '/workspace/Clients/Alice/missing.docx',
      name: 'missing.docx',
      handleFileOpen: vi.fn(async () => false),
      setSidebarActiveTab,
      setDocumentsView: vi.fn(),
    });

    expect(opened).toBe(false);
    expect(setSidebarActiveTab).not.toHaveBeenCalled();
  });

  it('opens a client workflow artifact in that client Documents tab', async () => {
    const setSidebarActiveTab = vi.fn();
    const setDocumentsView = vi.fn();
    const setMattersSurfaceMode = vi.fn();
    const pushNavigationSnapshot = vi.fn();

    const opened = await openRunArtifactFromWorkflows({
      path: '/workspace/Clients/Alice/Documents/Workflows/Annual/report.docx',
      name: 'report.docx',
      handleFileOpen: vi.fn(async () => true),
      setSidebarActiveTab,
      setDocumentsView,
      setMattersSurfaceMode,
      pushNavigationSnapshot,
    });

    expect(opened).toBe(true);
    expect(pushNavigationSnapshot).toHaveBeenCalledTimes(1);
    expect(matterState.setActiveMatter).toHaveBeenCalledWith('client-1');
    expect(pushNavigationSnapshot.mock.invocationCallOrder[0]).toBeLessThan(
      matterState.setActiveMatter.mock.invocationCallOrder[0] ?? Number.MAX_SAFE_INTEGER
    );
    expect(matterState.setClientMapHubId).toHaveBeenCalledWith('client-1');
    expect(matterState.setClientMapHubTab).toHaveBeenCalledWith('documents');
    expect(setMattersSurfaceMode).toHaveBeenCalledWith('client-map');
    expect(setDocumentsView).toHaveBeenCalledWith('editor');
    expect(setSidebarActiveTab).toHaveBeenCalledWith('matters');
  });

  it('still opens an unscoped workflow artifact in the main Documents area', async () => {
    const setSidebarActiveTab = vi.fn();

    const opened = await openRunArtifactFromWorkflows({
      path: '/workspace/Workflows/report.docx',
      name: 'report.docx',
      handleFileOpen: vi.fn(async () => true),
      setSidebarActiveTab,
      setDocumentsView: vi.fn(),
    });

    expect(opened).toBe(true);
    expect(setSidebarActiveTab).toHaveBeenCalledWith('files');
  });
});
