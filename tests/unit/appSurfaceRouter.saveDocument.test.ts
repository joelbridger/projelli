import { describe, expect, it, vi, beforeEach } from 'vitest';
import { routeSavedAskDocument } from '@/app/shell/routeSavedAskDocument';
import type { Matter } from '@/platform/types/matter';

const matterState = {
  setActiveMatter: vi.fn(),
  setClientMapHubId: vi.fn(),
  setClientMapHubTab: vi.fn(),
};

vi.mock('@/platform/matter/matterStore', () => ({
  useMatterStore: {
    getState: () => matterState,
  },
}));

function sampleMatter(): Matter {
  return {
    id: 'client-1',
    name: 'Morgan Household',
    client: 'Morgan Household',
    folderPaths: [],
    createdAt: '2026-07-06T00:00:00.000Z',
    privileged: true,
  };
}

describe('routeSavedAskDocument', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('opens the saved document inside the active client Documents tab', () => {
    const setDocumentsView = vi.fn();
    const setSidebarActiveTab = vi.fn();

    routeSavedAskDocument({
      activeMatter: sampleMatter(),
      setDocumentsView,
      setSidebarActiveTab,
    });

    expect(setDocumentsView).toHaveBeenCalledWith('editor');
    expect(matterState.setActiveMatter).toHaveBeenCalledWith('client-1');
    expect(matterState.setClientMapHubId).toHaveBeenCalledWith('client-1');
    expect(matterState.setClientMapHubTab).toHaveBeenCalledWith('documents');
    expect(setSidebarActiveTab).toHaveBeenCalledWith('matters');
  });

  it('opens the saved document in the main Documents area when no client is active', () => {
    const setDocumentsView = vi.fn();
    const setSidebarActiveTab = vi.fn();

    routeSavedAskDocument({
      activeMatter: null,
      setDocumentsView,
      setSidebarActiveTab,
    });

    expect(setDocumentsView).toHaveBeenCalledWith('editor');
    expect(setSidebarActiveTab).toHaveBeenCalledWith('files');
    expect(matterState.setActiveMatter).not.toHaveBeenCalled();
    expect(matterState.setClientMapHubId).not.toHaveBeenCalled();
    expect(matterState.setClientMapHubTab).not.toHaveBeenCalled();
  });
});
