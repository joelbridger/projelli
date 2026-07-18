import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  assertSavedDocumentTargetCurrent,
  resolveSavedDocumentTarget,
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
const selectionState = vi.hoisted(() => ({
  decision: null as null | {
    kind: 'matter' | 'all-matters' | 'refused';
    matter?: Matter;
    client?: null;
    sourceKind?: 'matter' | 'matter-only';
    reason?: 'selection-changed' | 'blocked-unresolved' | 'follower-disagreement';
    message?: string;
  },
}));

vi.mock('@/platform/client-context', () => ({
  readSelectionOperationDecision: () => selectionState.decision,
  expectedScopeFromDecision: (decision: { kind: string; matter?: Matter }) =>
    decision.kind === 'matter'
      ? { kind: 'matter', matterId: decision.matter?.id }
      : { kind: 'all-matters' },
  issueMatterScopeSelection: (matterId: string) => ({ matterId }),
  requestMatterScopeSelection: async (request: { matterId: string }) => {
    matterState.setActiveMatter(request.matterId);
    return { kind: 'applied', scope: { kind: 'matter', matterId: request.matterId } };
  },
}));

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
    selectionState.decision = {
      kind: 'matter',
      sourceKind: 'matter-only',
      matter: sampleMatter(),
      client: null,
    };
  });

  it('opens the saved document through the document tab store before routing', async () => {
    const setDocumentsView = vi.fn();
    const setSidebarActiveTab = vi.fn();

    await routeSavedAskDocument({
      expectedScope: { kind: 'matter', matterId: 'client-1' },
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
      expectedScope: { kind: 'matter', matterId: 'client-1' },
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

    selectionState.decision = { kind: 'all-matters', client: null };
    await routeSavedAskDocument({
      expectedScope: { kind: 'all-matters' },
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
      resolveSavedDocumentTarget({
        rootPath: '/workspace',
        fileName: 'Planning notes.docx',
      }).path
    ).toBe('/workspace/Clients/Morgan Household/Documents/Planning notes.docx');
  });

  it('refuses a blocked source before choosing an Ask or email artifact destination', () => {
    selectionState.decision = {
      kind: 'refused',
      reason: 'blocked-unresolved',
      message: 'The selected client is still unresolved.',
    };

    expect(() =>
      resolveSavedDocumentTarget({
        rootPath: '/workspace',
        fileName: 'Planning notes.docx',
      }),
    ).toThrow('still unresolved');
  });

  it('refuses forced disagreement immediately before the artifact write', () => {
    selectionState.decision = {
      kind: 'refused',
      reason: 'follower-disagreement',
      message: 'The client selection is still catching up.',
    };

    expect(() =>
      assertSavedDocumentTargetCurrent({ kind: 'matter', matterId: 'client-1' }),
    ).toThrow('still catching up');
  });

  it('saves a new Ask or email document at the workspace root only when no client is active', () => {
    selectionState.decision = { kind: 'all-matters', client: null };
    expect(
      resolveSavedDocumentTarget({
        rootPath: '/workspace',
        fileName: 'Planning notes.docx',
      }).path
    ).toBe('/workspace/Planning notes.docx');
  });

  it('refuses and surfaces when the selection changes before routing', async () => {
    selectionState.decision = {
      kind: 'refused',
      reason: 'selection-changed',
      message: 'The selected client changed.',
    };
    const setDocumentsView = vi.fn();
    const setSidebarActiveTab = vi.fn();

    await expect(
      routeSavedAskDocument({
        expectedScope: { kind: 'matter', matterId: 'client-1' },
        savedDocument: {
          path: '/workspace/Clients/Morgan Household/Documents/Planning notes.docx',
          name: 'Planning notes.docx',
          content: 'data:docx',
        },
        setDocumentsView,
        setSidebarActiveTab,
      }),
    ).rejects.toThrow('The selected client changed.');
    expect(setSidebarActiveTab).toHaveBeenCalledWith('files');
    expect(openFileMock).toHaveBeenCalledTimes(1);
  });
});
