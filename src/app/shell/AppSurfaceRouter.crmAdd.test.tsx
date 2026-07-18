import { useState } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSurface } from '@/platform/types/navigation';
import type { LiveCrmRecord } from '@/platform/crm/liveRecords';
import { AppSurfaceRouter, type AppSurfaceRouterProps } from './AppSurfaceRouter';
import { useMatterStore } from '@/platform/matter/matterStore';
import { setDevFlagOverride } from '@/platform/flags';
import { memberRailTab, registerHouseholdTab } from '@/features/crm-clients';

const mail = vi.hoisted(() => ({
  desktop: true,
  connectedAccounts: vi.fn(),
  listMessages: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => mail.desktop }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn().mockResolvedValue(vi.fn()) }));
vi.mock('@/platform/utils/mail-commands', () => ({
  mailConnectedAccounts: mail.connectedAccounts,
  mailListMessages: mail.listMessages,
  mailListMessagesByMatter: vi.fn(),
  mailGetMessage: vi.fn(),
  mailRetagFolderMatter: vi.fn(),
  mailRetagMessageMatter: vi.fn(),
  mailSend: vi.fn(),
  mailSyncAll: vi.fn().mockResolvedValue(undefined),
  mailCancelSync: vi.fn().mockResolvedValue(undefined),
  MAIL_SYNC_EVENT: 'mail-sync-progress',
}));

const records: readonly LiveCrmRecord[] = [
  {
    id: 'h-1',
    kind: 'household',
    matterId: 'matter-1',
    name: 'Henderson household',
    lifecycle: 'Active',
    primaryAdvisor: 'Maya',
    ownership: 'mine',
    serviceTier: 'Platinum',
    facts: [],
    accounts: [],
    members: [{
      id: 'person-jordan',
      name: 'Jordan Henderson',
      personType: 'person',
      roles: ['Client'],
      householdRole: 'Spouse',
      relatedHouseholds: 1,
      emails: [{ id: 'email-jordan', address: 'jordan@example.com', kind: 'home', primary: true }],
    }],
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
    mail.desktop = true;
    mail.connectedAccounts.mockResolvedValue([
      { provider: 'm365', account: 'default', label: 'Work' },
    ]);
    mail.listMessages.mockResolvedValue({ items: [], total: 0 });
    localStorage.setItem('lantern:crm:selected-household:/workspace', 'matter-1');
    useMatterStore.setState({
      matters: [{
        id: 'matter-1',
        name: 'Henderson household',
        client: 'Henderson household',
        crmHouseholdKeys: ['h-1'],
        folderPaths: ['/workspace/Clients/Henderson household'],
        createdAt: '2026-07-14T00:00:00.000Z',
      }],
      activeMatterId: 'matter-1',
    });
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
    setDevFlagOverride('workflow-record-quickadd', undefined);
    setDevFlagOverride('crm-shell-v1', undefined);
    setDevFlagOverride('record-member-kebab', undefined);
    useMatterStore.setState({ matters: [], activeMatterId: null });
  });

  it('saves both household and person context when Add task starts from a member record', async () => {
    setDevFlagOverride('crm-shell-v1', false);
    setDevFlagOverride('record-member-kebab', true);
    const unregisterMemberTab = registerHouseholdTab(memberRailTab);
    save.mockClear();
    try {
      render(<Harness />);

      fireEvent.click(await screen.findByTestId('crm-household-tab-members'));
      fireEvent.click(await screen.findByTestId('crm-household-member-kebab-person-jordan'));
      fireEvent.click(screen.getByTestId('crm-household-member-task-person-jordan'));

      expect(await screen.findByTestId('crm-task-detail')).toBeInTheDocument();
      fireEvent.change(screen.getByTestId('crm-task-title-input'), {
        target: { value: 'Call Jordan Henderson' },
      });
      fireEvent.click(screen.getByTestId('crm-task-save'));

      await waitFor(() => {
        const taskWrite = save.mock.calls.find(
          ([record]) => record.kind === 'task' && record['title'] === 'Call Jordan Henderson',
        );
        expect(taskWrite?.[0]?.['contextRefs']).toEqual([
          {
            kind: 'household',
            id: 'h-1',
            matterId: 'matter-1',
          },
          {
            kind: 'person',
            id: 'person-jordan',
            matterId: 'matter-1',
            label: 'Jordan Henderson',
          },
        ]);
      });
    } finally {
      unregisterMemberTab();
    }
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
      matterId: 'matter-1',
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

    it('opens and saves a new task with the current household attached', async () => {
      save.mockClear();
      render(<Harness />);

      fireEvent.click(await screen.findByTestId('crm-household-add'));
      fireEvent.click(screen.getByTestId('crm-household-add-task'));

      expect(await screen.findByTestId('crm-task-detail')).toBeInTheDocument();
      expect(screen.getByTestId('crm-task-household')).toHaveValue('h-1');
      fireEvent.change(screen.getByTestId('crm-task-title-input'), {
        target: { value: 'Review Henderson plan' },
      });
      fireEvent.click(screen.getByTestId('crm-task-save'));

      await waitFor(() => {
        const taskWrite = save.mock.calls.find(
          ([record]) => record.kind === 'task' && record['title'] === 'Review Henderson plan',
        );
        expect(taskWrite?.[0]).toMatchObject({
          householdRef: {
            kind: 'household',
            id: 'h-1',
            matterId: 'matter-1',
          },
        });
      });
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

  it.each([
    ['connected', () => {
      mail.desktop = true;
      mail.connectedAccounts.mockResolvedValue([{ provider: 'm365', account: 'default', label: 'Work' }]);
    }, async () => {
      expect(await screen.findByTestId('compose-household-context')).toHaveTextContent('Henderson household');
    }],
    ['unconnected', () => {
      mail.desktop = true;
      mail.connectedAccounts.mockResolvedValue([]);
    }, async () => {
      expect(await screen.findByTestId('email-compose-handoff-message')).toHaveTextContent('No email account is connected');
    }],
    ['mail connection failure', () => {
      mail.desktop = true;
      mail.connectedAccounts.mockRejectedValue(new Error('mail unavailable'));
    }, async () => {
      expect(await screen.findByTestId('email-compose-handoff-message')).toHaveTextContent('could not check your email connection');
    }],
  ])('takes the real household Email action through the shell when mail is %s', async (_state, setup, assertResult) => {
    setup();
    render(<Harness />);

    fireEvent.click(await screen.findByRole('button', { name: 'Email' }));
    fireEvent.click(screen.getByTestId('crm-open-mail-surface'));

    await assertResult();
  });

  it('explains the desktop boundary instead of silently opening a browser draft', async () => {
    mail.desktop = false;
    render(<Harness />);

    fireEvent.click(await screen.findByRole('button', { name: 'Email' }));
    fireEvent.click(screen.getByTestId('crm-open-mail-surface'));

    expect(await screen.findByTestId('email-compose-handoff-message')).toHaveTextContent(
      'Email drafts open in the desktop app.',
    );
    expect(screen.queryByTestId('compose-household-context')).not.toBeInTheDocument();
  });
});
