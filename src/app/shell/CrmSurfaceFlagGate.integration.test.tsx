import { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AppSurfaceRouter,
  type AppSurfaceRouterProps,
} from '@/app/shell/AppSurfaceRouter';
import {
  getAppSurfaceDescriptor,
  getAppSurfaceDescriptors,
  getOrderedAppSurfaces,
} from '@/app/shell/registry/appSurfaceRegistry';
import { V1ShellFrameFlagGate } from '@/app/shell/v1-frame/V1ShellFrame';
import { setDevFlagOverride } from '@/platform/flags';
import type { AppSurface } from '@/platform/types/navigation';

const { useLiveCrmRecords } = vi.hoisted(() => ({
  useLiveCrmRecords: vi.fn(() => ({
    records: [
      {
        id: 'shell-live-task',
        kind: 'task',
        matterId: 'firm_home',
        title: 'Review Northcrest plan',
        assigneeUserId: null,
        status: 'open',
        priority: 'normal',
        contextRefs: [],
        customFields: {},
      },
    ],
    save: vi.fn(() => Promise.resolve()),
    reload: vi.fn(),
    error: null,
    workspaceRoot: '/workspace',
    freshness: { kind: 'live' as const },
    sharedMatterId: null,
  })),
}));

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

function CrmRouteHarness() {
  const [activeTab, setActiveTab] = useState<AppSurface>('home');
  return (
    <V1ShellFrameFlagGate
      activeSurface={activeTab}
      legacy={<div data-testid="legacy-app-shell" />}
      onOpenCommandPalette={vi.fn()}
      onSurfaceChange={setActiveTab}
    >
      <AppSurfaceRouter {...baseProps(activeTab, setActiveTab)} />
    </V1ShellFrameFlagGate>
  );
}

function setShellFlags(crmShellEnabled: boolean | undefined) {
  setDevFlagOverride('v1-shell-frame', true);
  setDevFlagOverride('crm-shell-v1', crmShellEnabled);
}

describe('real CRM surface flag-gated swap', () => {
  beforeEach(() => {
    useLiveCrmRecords.mockClear();
  });

  afterEach(() => {
    cleanup();
    setDevFlagOverride('v1-shell-frame', undefined);
    setDevFlagOverride('crm-shell-v1', undefined);
  });

  it('keeps the legacy CRM mounted through the existing registry, main navigation, and router while dark', async () => {
    setShellFlags(false);

    expect(getAppSurfaceDescriptor('home')).toBeDefined();
    expect(getAppSurfaceDescriptors().map(({ id }) => id)).not.toContain('crm');
    expect(getOrderedAppSurfaces('primary').map(({ id }) => id)).toEqual([
      'home',
      'matters',
      'search',
    ]);
    render(<CrmRouteHarness />);

    expect(screen.getByTestId('v1-shell-nav-home')).toBeInTheDocument();
    expect(screen.queryByTestId('v1-shell-nav-crm')).not.toBeInTheDocument();
    expect(await screen.findByTestId('crm-home')).toBeInTheDocument();
    expect(screen.queryByTestId('crm-shell-frame')).not.toBeInTheDocument();
    // The unchanged legacy CRM still owns its normal live-record load. The
    // dark v1 frame contributes no additional CRM destination/data work.
    expect(useLiveCrmRecords).toHaveBeenCalledOnce();
  });

  it('uses that same Home route to render real, live registry destinations without exposing dark destinations', async () => {
    setShellFlags(true);
    render(<CrmRouteHarness />);

    expect(await screen.findByTestId('crm-shell-frame')).toBeInTheDocument();
    expect(screen.queryByTestId('crm-home')).not.toBeInTheDocument();
    expect(screen.queryByTestId('v1-shell-nav-crm')).not.toBeInTheDocument();
    expect(screen.getByTestId('crm-shell-nav-today')).toBeInTheDocument();
    expect(
      screen.queryByTestId('crm-shell-nav-internal-projects')
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId('crm-shell-nav-form-activity')
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId('crm-shell-nav-trash')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('crm-shell-nav-tasks'));

    expect(
      screen.getByTestId('crm-task-record-shell-live-task')
    ).toHaveTextContent('Review Northcrest plan');
    expect(useLiveCrmRecords).toHaveBeenCalled();
  });
});
