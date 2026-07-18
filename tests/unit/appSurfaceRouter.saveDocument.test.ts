import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  resolveSavedDocumentPath,
  routeSavedAskDocument,
} from '@/app/shell/routeSavedAskDocument';
import type { Matter } from '@/platform/types/matter';

const matterState = {
  matters: [
    {
      id: 'client-1',
      name: 'Morgan Household',
      client: 'Morgan Household',
      folderPaths: ['/workspace/Clients/Morgan Household'],
      createdAt: '2026-07-06T00:00:00.000Z',
    },
  ],
  activeMatterId: null,
  setActiveMatter: vi.fn(),
  setClientMapHubId: vi.fn(),
  setClientMapHubTab: vi.fn(),
};
const openFileMock = vi.hoisted(() => vi.fn());

vi.mock('@/platform/matter/matterStore', () => ({
  useMatterStore: {
    getState: () => matterState,
    subscribe: () => () => {},
  },
}));
vi.mock('@/platform/state/editorStore', () => ({
  useEditorStore: {
    getState: () => ({ openFile: openFileMock }),
  },
}));

function sampleMatter(): Matter {
  return {
    id: 'client-1',
    name: 'Morgan Household',
    client: 'Morgan Household',
    folderPaths: ['/workspace/Clients/Morgan Household'],
    createdAt: '2026-07-06T00:00:00.000Z',
    privileged: true,
  };
}

describe('routeSavedAskDocument', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('opens the saved document through the document tab store before routing', async () => {
    const setDocumentsView = vi.fn();
    const setSidebarActiveTab = vi.fn();

    await routeSavedAskDocument({
      activeMatter: sampleMatter(),
      savedDocument: {
        path: '/workspace/Clients/Morgan Household/Documents/Planning notes.docx',
        name: 'Planning notes.docx',
        content: 'data:docx',
      },
      setDocumentsView,
      setSidebarActiveTab,
    });

    expect(openFileMock).toHaveBeenCalledWith(
      '/workspace/Clients/Morgan Household/Documents/Planning notes.docx',
      'Planning notes.docx',
      'data:docx',
    );
    expect(setDocumentsView).toHaveBeenCalledWith('editor');
  });

  it('opens the saved document inside the active client Documents tab', async () => {
    const setDocumentsView = vi.fn();
    const setSidebarActiveTab = vi.fn();
    const pushNavigationSnapshot = vi.fn();

    await routeSavedAskDocument({
      activeMatter: sampleMatter(),
      setDocumentsView,
      setSidebarActiveTab,
      pushNavigationSnapshot,
    });

    expect(pushNavigationSnapshot).toHaveBeenCalledTimes(1);
    expect(setDocumentsView).toHaveBeenCalledWith('editor');
    expect(matterState.setActiveMatter).toHaveBeenCalledWith('client-1');
    expect(matterState.setClientMapHubId).toHaveBeenCalledWith('client-1');
    expect(matterState.setClientMapHubTab).toHaveBeenCalledWith('documents');
    expect(setSidebarActiveTab).toHaveBeenCalledWith('matters');
  });

  it('opens the saved document in the main Documents area when no client is active', async () => {
    const setDocumentsView = vi.fn();
    const setSidebarActiveTab = vi.fn();
    const pushNavigationSnapshot = vi.fn();

    await routeSavedAskDocument({
      activeMatter: null,
      setDocumentsView,
      setSidebarActiveTab,
      pushNavigationSnapshot,
    });

    expect(pushNavigationSnapshot).toHaveBeenCalledTimes(1);
    expect(setDocumentsView).toHaveBeenCalledWith('editor');
    expect(setSidebarActiveTab).toHaveBeenCalledWith('files');
    expect(matterState.setActiveMatter).not.toHaveBeenCalled();
    expect(matterState.setClientMapHubId).not.toHaveBeenCalled();
    expect(matterState.setClientMapHubTab).not.toHaveBeenCalled();
  });

  it('saves a new Ask or email document inside the active client Documents folder', () => {
    expect(
      resolveSavedDocumentPath({
        rootPath: '/workspace',
        activeMatter: sampleMatter(),
        fileName: 'Planning notes.docx',
      })
    ).toBe('/workspace/Clients/Morgan Household/Documents/Planning notes.docx');
  });

  it('saves a new Ask or email document at the workspace root only when no client is active', () => {
    expect(
      resolveSavedDocumentPath({
        rootPath: '/workspace',
        activeMatter: null,
        fileName: 'Planning notes.docx',
      })
    ).toBe('/workspace/Planning notes.docx');
  });
});
