import { useState } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSurface } from '@/platform/types/navigation';
import type { LiveCrmRecord } from '@/platform/crm/liveRecords';
import { AppSurfaceRouter, type AppSurfaceRouterProps } from './AppSurfaceRouter';
import { useMatterStore } from '@/platform/matter/matterStore';
import { setDevFlagOverride } from '@/platform/flags';

const records: readonly LiveCrmRecord[] = [
  {
    id: 'h-1',
    kind: 'household',
    matterId: 'h-1',
    name: 'Henderson household',
    lifecycle: 'Active',
    primaryAdvisor: 'Maya',
    ownership: 'mine',
    serviceTier: 'Platinum',
    facts: [],
    accounts: [],
    members: [],
    externalParties: [],
    notes: [],
    customFields: [],
    tags: [],
    contextRefs: [],
  },
  {
    id: 'pipeline-1',
    kind: 'pipelineDef',
    matterId: 'firm_home',
    name: 'New clients',
    description: '',
    stageIds: ['stage-1'],
    stageOrder: ['stage-1'],
    archived: false,
  },
  {
    id: 'stage-1',
    kind: 'stageDef',
    matterId: 'firm_home',
    pipelineId: 'pipeline-1',
    name: 'Discovery',
    statusEffect: 'open',
    triggerRules: [],
    archived: false,
  },
  {
    id: 'workflow-1',
    kind: 'crm_workflow_template',
    matterId: 'firm_home',
    name: 'Annual review',
    steps: [],
    snapshot: {
      id: 'workflow-1',
      headRevisionIds: [],
      revisions: {},
    },
  },
];

const save = vi.fn((record: LiveCrmRecord) => Promise.resolve(record));

vi.mock('@/platform/crm/useLiveCrmRecords', () => ({
  useLiveCrmRecords: () => ({
    records,
    save,
    reload: vi.fn(),
    error: null,
    workspaceRoot: '/workspace',
    freshness: { kind: 'live' as const },
    sharedMatterId: null,
  }),
}));

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
  setSidebarActiveTab: (tab: AppSurface) => void,
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

function Harness() {
  const [activeTab, setActiveTab] = useState<AppSurface>('matters');
  return (
    <>
      <button
        data-testid="router-show-record"
        onClick={() => {
          setActiveTab('matters');
        }}
      >
        Show record
      </button>
      <button
        data-testid="router-revisit-home"
        onClick={() => {
          setActiveTab('home');
        }}
      >
        Revisit home
      </button>
      <AppSurfaceRouter {...baseProps(activeTab, setActiveTab)} />
    </>
  );
}

describe('CRM household add actions', () => {
  beforeEach(() => {
    localStorage.setItem('lantern:crm:selected-household:/workspace', 'h-1');
    useMatterStore.setState({
      matters: [{
        id: 'h-1',
        name: 'Henderson household',
        client: 'Henderson household',
        folderPaths: ['/workspace/Clients/Henderson household'],
        createdAt: '2026-07-14T00:00:00.000Z',
      }],
      activeMatterId: 'h-1',
    });
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
    setDevFlagOverride('workflow-record-quickadd', undefined);
    setDevFlagOverride('crm-shell-v1', undefined);
    useMatterStore.setState({ matters: [], activeMatterId: null });
  });

  it('starts once from the public household workflow action and does not replay on revisit', async () => {
    setDevFlagOverride('crm-shell-v1', false);
    setDevFlagOverride('workflow-record-quickadd', true);
    save.mockClear();
    render(<Harness />);

    fireEvent.click(await screen.findByTestId('crm-household-add'));
    fireEvent.click(screen.getByTestId('crm-household-add-workflow'));

    expect(
      await screen.findByTestId('workflow-record-quickadd')
    ).toHaveTextContent('Henderson household');
    expect(
      screen.getByTestId('workflow-record-quickadd-template-workflow-1')
    ).toBeVisible();
    fireEvent.click(screen.getByTestId('workflow-record-quickadd-start'));

    await waitFor(() => {
      expect(
        screen.queryByTestId('workflow-record-quickadd')
      ).not.toBeInTheDocument();
    });
    const instanceWrites = save.mock.calls.filter(
      ([record]) => record.kind === 'crm_workflow_instance'
    );
    expect(instanceWrites).toHaveLength(1);
    expect(instanceWrites[0]?.[0]).toMatchObject({
      householdId: 'h-1',
      householdLabel: 'Henderson household',
      matterId: 'h-1',
      templateId: 'workflow-1',
    });

    fireEvent.click(screen.getByTestId('router-show-record'));
    await screen.findByTestId('crm-household-add');
    fireEvent.click(screen.getByTestId('router-revisit-home'));
    await screen.findByTestId('crm-home');
    expect(
      screen.queryByTestId('workflow-record-quickadd')
    ).not.toBeInTheDocument();
    expect(
      save.mock.calls.filter(
        ([record]) => record.kind === 'crm_workflow_instance'
      )
    ).toHaveLength(1);
  });

  describe.each([
    ['with the CRM shell off', false],
    ['with the CRM shell on', true],
  ])('%s', (_label, crmShellEnabled) => {
    beforeEach(() => {
      setDevFlagOverride('crm-shell-v1', crmShellEnabled);
    });

    afterEach(() => {
      setDevFlagOverride('crm-shell-v1', undefined);
    });

    it('opens a new task form with the current household already selected', async () => {
      render(<Harness />);

      fireEvent.click(await screen.findByTestId('crm-household-add'));
      fireEvent.click(screen.getByTestId('crm-household-add-task'));

      expect(await screen.findByTestId('crm-task-detail')).toBeInTheDocument();
      expect(screen.getByTestId('crm-task-household')).toHaveValue('h-1');
    });

    it('opens a new opportunity form with the current household already selected', async () => {
      render(<Harness />);

      fireEvent.click(await screen.findByTestId('crm-household-add'));
      fireEvent.click(screen.getByTestId('crm-household-add-opportunity'));

      expect(await screen.findByTestId('crm-opportunity-editor')).toBeInTheDocument();
      expect(screen.getByTestId('crm-opportunity-household')).toHaveValue('h-1');
    });

    it('opens the workflow form with the current household already selected', async () => {
      render(<Harness />);

      fireEvent.click(await screen.findByTestId('crm-household-add'));
      fireEvent.click(screen.getByTestId('crm-household-add-workflow'));

      expect(await screen.findByTestId('crm-live-workflow-household')).toHaveValue('h-1');
      expect(screen.getByTestId('crm-live-workflow-start')).toBeInTheDocument();
    });
  });

  it('creates a document from the household tab inside that household folder', async () => {
    const handleCreateDefaultDocument = vi.fn();
    render(
      <AppSurfaceRouter
        {...baseProps('matters', vi.fn())}
        handleCreateDefaultDocument={handleCreateDefaultDocument}
      />,
    );

    fireEvent.click(await screen.findByTestId('crm-household-tab-documents'));
    const trigger = await screen.findByTestId('documents-files-create-menu');
    fireEvent.pointerDown(trigger, new MouseEvent('pointerdown', { bubbles: true }));
    fireEvent.click(trigger);
    fireEvent.click(await screen.findByTestId('documents-create-document'));

    await waitFor(() => {
      expect(handleCreateDefaultDocument).toHaveBeenCalledWith(
        '/workspace/Clients/Henderson household',
      );
    });
  });
});
