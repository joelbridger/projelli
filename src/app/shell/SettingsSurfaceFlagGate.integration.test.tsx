import { useState } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getAppSurfaceDescriptor } from '@/app/shell/registry/appSurfaceRegistry';
import { AppSurfaceRouter, type AppSurfaceRouterProps } from '@/app/shell/AppSurfaceRouter';
import { setDevFlagOverride } from '@/platform/flags';
import { useSettingsStore } from '@/platform/settings/settingsStore';
import type { AuditEntry } from '@/platform/types/audit';
import type { AuditIntegrityVerdict } from '@/platform/utils/tauri-commands';
import type { Matter } from '@/platform/types/matter';
import type { AppSurface } from '@/platform/types/navigation';

const { useLiveCrmRecords, invoke } = vi.hoisted(() => ({
  useLiveCrmRecords: vi.fn(),
  invoke: vi.fn(() =>
    Promise.resolve({
      roles: [],
      teams: [],
      memberships: [],
      updatedAt: '2026-07-16T00:00:00.000Z',
    })
  ),
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

const activeMatter: Matter = {
  id: 'matter-active',
  name: 'Northstar review',
  client: 'Northstar household',
  folderPaths: ['/workspace/northstar'],
  createdAt: '2026-07-16T00:00:00.000Z',
};

const firstAuditEntry: AuditEntry = {
  id: 'audit-1',
  timestamp: '2026-07-16T00:00:00.000Z',
  action: 'file_export',
  description: 'Exported the Northstar review packet',
  model: undefined,
  inputs: {},
  outputs: {},
  userDecision: 'approved',
  metadata: { matterId: activeMatter.id },
};
const auditEntries: AuditEntry[] = [firstAuditEntry];

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
vi.mock('@tauri-apps/api/core', () => ({ invoke, isTauri: () => true }));

function baseProps(
  sidebarActiveTab: AppSurface,
  setSidebarActiveTab: (tab: AppSurface) => void,
  overrides: Partial<AppSurfaceRouterProps> = {},
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
    auditEntries,
    auditIntegrity: { status: 'sealMissing', survivingRows: 1, lastTimestamp: firstAuditEntry.timestamp },
    verifyAuditIntegrity: vi.fn(() => Promise.resolve<AuditIntegrityVerdict>({ status: 'verified', checked: 1 })),
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
    activeMatter,
    ...overrides,
  };
}

function SettingsHarness() {
  const [activeTab, setActiveTab] = useState<AppSurface>('settings');
  const [integrity, setIntegrity] = useState<AuditIntegrityVerdict>({
    status: 'sealMissing',
    survivingRows: 1,
    lastTimestamp: firstAuditEntry.timestamp,
  });
  const repairAuditSeal = vi.fn(() => {
    setIntegrity({ status: 'verified', checked: auditEntries.length });
    return Promise.resolve();
  });
  return (
    <AppSurfaceRouter
      {...baseProps(activeTab, setActiveTab, {
        auditIntegrity: integrity,
        repairAuditSeal,
      })}
    />
  );
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
    invoke.mockClear();
    useSettingsStore.getState().resetAll();
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

  it('uses the real registry/router Settings route to keep live Settings inputs and nested destinations', async () => {
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

    fireEvent.click(screen.getByTestId('settings-v1-section-advanced'));
    expect(await screen.findByTestId('template-model-settings')).toBeInTheDocument();
    expect(screen.getByTestId('template-model-add').querySelectorAll('option').length).toBeGreaterThan(1);

    fireEvent.change(screen.getByTestId('settings-v1-search'), {
      target: { value: 'save automatically' },
    });
    expect(screen.getByTestId('settings-v1-section-workspace')).toBeVisible();
    expect(screen.queryByTestId('settings-v1-section-advanced')).not.toBeInTheDocument();
    expect(await screen.findByText('Autosave')).toBeVisible();

    fireEvent.click(screen.getByTestId('settings-category-privacy-center'));
    expect(await screen.findByTestId('privacy-center-scroll')).toBeInTheDocument();
    const reportButton = screen.getByTestId('privacy-center-report-button');
    expect(reportButton).toHaveTextContent('Confidentiality Report');
    fireEvent.click(reportButton);
    expect(await screen.findByTestId('confidentiality-report')).toHaveTextContent(
      'Northstar review',
    );

    fireEvent.click(screen.getByTestId('settings-category-activity-log'));
    expect(await screen.findByTestId('audit-home-search')).toBeInTheDocument();
    expect(screen.getByText('Exported the Northstar review packet')).toBeVisible();
    fireEvent.click(screen.getByTestId('audit-repair-button'));
    fireEvent.click(await screen.findByTestId('confirm-dialog-confirm'));
    await waitFor(() => {
      expect(screen.getByTestId('audit-integrity-badge')).toHaveAttribute(
        'data-integrity-status',
        'verified',
      );
    });

    fireEvent.pointerDown(screen.getByTestId('settings-v1-actions-menu'), {
      button: 0,
      ctrlKey: false,
    });
    expect(screen.getByTestId('settings-v1-export')).toBeInTheDocument();
    expect(screen.getByTestId('settings-v1-import')).toBeInTheDocument();
    expect(screen.getByTestId('settings-v1-reset')).toBeInTheDocument();

    useSettingsStore.getState().setSetting('fontSize', 22);
    const download = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => {});
    const createObjectUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:settings-export');
    fireEvent.click(screen.getByTestId('settings-v1-export'));
    expect(createObjectUrl).toHaveBeenCalledWith(expect.any(Blob));
    expect(download).toHaveBeenCalledOnce();
    const exported = createObjectUrl.mock.calls[0]?.[0] as Blob;
    const exportedText = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === 'string') {
          resolve(reader.result);
          return;
        }
        reject(new Error('Settings export did not produce text.'));
      };
      reader.onerror = () => {
        reject(reader.error ?? new Error('Could not read settings export.'));
      };
      reader.readAsText(exported);
    });
    expect(exportedText).toContain('"fontSize": 22');
    createObjectUrl.mockRestore();
    download.mockRestore();

    fireEvent.pointerDown(screen.getByTestId('settings-v1-actions-menu'), {
      button: 0,
      ctrlKey: false,
    });
    fireEvent.click(await screen.findByTestId('settings-v1-reset'));
    fireEvent.click(await screen.findByTestId('confirm-dialog-confirm'));
    await waitFor(() => {
      expect(useSettingsStore.getState().getSetting('fontSize')).toBe(14);
    });
  });
});
