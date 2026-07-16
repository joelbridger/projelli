import { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getAppSurfaceDescriptor } from '@/app/shell/registry/appSurfaceRegistry';
import { AppSurfaceRouter, type AppSurfaceRouterProps } from '@/app/shell/AppSurfaceRouter';
import { setDevFlagOverride } from '@/platform/flags';
import type { AppSurface } from '@/platform/types/navigation';

const { useLiveCrmRecords } = vi.hoisted(() => ({
  useLiveCrmRecords: vi.fn(),
}));

const liveCrmRecords = {
    records: [],
    save: vi.fn(() => Promise.resolve()),
    reload: vi.fn(),
    error: null,
    workspaceRoot: '/workspace',
    freshness: { kind: 'live' as const },
    sharedMatterId: null,
};

vi.mock('@/platform/crm/useLiveCrmRecords', () => ({ useLiveCrmRecords }));
vi.mock('@/app/lifecycle/useIntakeInboxSync', () => ({
  useIntakeInboxSync: vi.fn(),
}));
vi.mock('@/platform/intake/useEmailReplyIngestion', () => ({
  useEmailReplyIngestion: vi.fn(),
}));
vi.mock('@/platform/intake/useDocumentExtractionIngestion', () => ({
  useDocumentExtractionIngestion: vi.fn(),
}));
vi.mock('@/features/crm-firm/teams-roles/teamsRolesClient', () => ({
  teamsRolesClient: {
    get: vi.fn(() =>
      Promise.resolve({
        roles: [],
        teams: [],
        memberships: [],
        updatedAt: '2026-07-16T00:00:00.000Z',
      })
    ),
    put: vi.fn(() => Promise.resolve()),
  },
}));

function baseProps(
  sidebarActiveTab: AppSurface,
  setSidebarActiveTab: (tab: AppSurface) => void
): AppSurfaceRouterProps {
  return {
    sidebarActiveTab,
    askPrefill: null,
    setAskPrefill: vi.fn(),
    documentsView: 'browser',
    setDocumentsView: vi.fn(),
    setSidebarActiveTab,
    mattersSurfaceMode: 'all-clients',
    setMattersSurfaceMode: vi.fn(),
    pushNavigationSnapshot: vi.fn(),
    currentExecution: null,
    activeWorkflowTemplate: null,
    showInterviewDialog: false,
    interviewQuestions: null,
    workflowProviderError: null,
    workflowSaveError: null,
    runHistory: [],
    auditEntries: [],
    auditIntegrity: undefined,
    verifyAuditIntegrity: vi.fn(() => Promise.resolve(undefined)),
    repairAuditSeal: vi.fn(() => Promise.resolve()),
    apiKeys: [],
    rootPath: '/workspace',
    fileTree: [],
    trashItems: [],
    trashStats: { itemCount: 0, totalSize: 0, oldestItem: undefined },
    trashRetentionPeriod: 30,
    trashCustomRetentionDays: 30,
    activeWorkflowFilePath: null,
    openTabs: [],
    workspaceServiceRef: { current: null },
    setFileTree: vi.fn(),
    openSettings: vi.fn(),
    handleFileOpen: vi.fn(() => Promise.resolve(false)),
    handleCreateFile: vi.fn(),
    handleCreateFolder: vi.fn(),
    handleRename: vi.fn(),
    handleRenameWithName: vi.fn(() => Promise.resolve()),
    handleDelete: vi.fn(),
    handleMove: vi.fn(() => Promise.resolve()),
    handleDownload: vi.fn(),
    handleCreateDefaultDocument: vi.fn(),
    handleImportFiles: vi.fn(() => Promise.resolve()),
    handleCreateDocxAtRoot: vi.fn(() => Promise.resolve()),
    handleCreateTextFileAtRoot: vi.fn(() => Promise.resolve()),
    handleCreateFolderAtRoot: vi.fn(() => Promise.resolve()),
    handleSetLetterheadTemplate: vi.fn(),
    handleRestoreFromTrash: vi.fn(() => Promise.resolve()),
    handlePermanentDelete: vi.fn(() => Promise.resolve()),
    handleEmptyTrash: vi.fn(() => Promise.resolve()),
    handleTrashRetentionChange: vi.fn(),
    refreshFileTree: vi.fn(),
    addAuditEntry: vi.fn(),
    handleRequestApiKeySetup: vi.fn(),
    handleInterviewSubmit: vi.fn(),
    handleInterviewCancel: vi.fn(),
    handleWorkflowSaveAsFile: vi.fn(() => Promise.resolve()),
    handleWorkflowExportDocx: vi.fn(() => Promise.resolve()),
    handleWorkflowExportPptx: vi.fn(() => Promise.resolve()),
    handleStartWorkflow: vi.fn(() => Promise.resolve()),
    handleSettingsAction: vi.fn(),
    handleSettingsRestartOnboarding: vi.fn(),
    activeMatter: null,
  };
}

function SettingsHarness() {
  const [activeTab, setActiveTab] = useState<AppSurface>('settings');
  return <AppSurfaceRouter {...baseProps(activeTab, setActiveTab)} />;
}

function setSettingsShell(enabled: boolean | undefined) {
  setDevFlagOverride('settings-shell-v1', enabled);
}

function setRegisteredPanels(enabled: boolean | undefined) {
  setDevFlagOverride('teams-roles', enabled);
  setDevFlagOverride('custom-fields-firm', enabled);
  setDevFlagOverride('contact-sources', enabled);
  setDevFlagOverride('notification-preferences', enabled);
}

describe('real Settings surface flag-gated swap', () => {
  beforeEach(() => {
    useLiveCrmRecords.mockReturnValue(liveCrmRecords);
    useLiveCrmRecords.mockClear();
  });

  afterEach(() => {
    cleanup();
    setSettingsShell(undefined);
    setRegisteredPanels(undefined);
  });

  it('uses the real registry/router Settings route unchanged while the flag is off', async () => {
    setSettingsShell(false);

    expect(getAppSurfaceDescriptor('settings')).toBeDefined();
    render(<SettingsHarness />);

    expect(await screen.findByTestId('settings-page')).toBeInTheDocument();
    expect(await screen.findByTestId('settings-content')).toHaveAttribute(
      'data-variant',
      'page'
    );
    expect(screen.queryByTestId('settings-v1-frame')).not.toBeInTheDocument();
    expect(useLiveCrmRecords).not.toHaveBeenCalled();
  });

  it('uses the real registry/router Settings route to mount every registered v1 panel', async () => {
    setSettingsShell(true);
    setRegisteredPanels(true);

    expect(getAppSurfaceDescriptor('settings')).toBeDefined();
    render(<SettingsHarness />);

    expect(await screen.findByTestId('settings-v1-frame')).toBeInTheDocument();
    expect(screen.queryByTestId('settings-page')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('settings-v1-section-organization'));
    expect(await screen.findByTestId('teams-roles-settings')).toBeInTheDocument();
    expect(screen.getByTestId('custom-fields-settings')).toBeInTheDocument();
    expect(screen.getByTestId('contact-sources-settings')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('settings-v1-section-personal'));
    expect(
      await screen.findByTestId('notification-preferences-panel')
    ).toBeInTheDocument();
  });
});
