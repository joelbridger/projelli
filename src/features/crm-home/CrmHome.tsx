/* eslint-disable lantern-i18n/no-hardcoded-string -- Frozen CRM screen copy needs its translation catalog in a separate product change. */
import {
  createElement,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import {
  Activity,
  BarChart3,
  Bell,
  ClipboardList,
  Download,
  FileArchive,
  Flag,
  GitPullRequest,
  LayoutDashboard,
  ListChecks,
  Plus,
  RefreshCw,
  ShieldCheck,
  Tags,
  Users,
  Workflow,
} from 'lucide-react';
import { SurfaceHeader } from '@/ui/SurfaceHeader';
import { Button } from '@/ui/kp';
import {
  getCrmEngineFreshness,
  subscribeCrmEngineFreshness,
} from '@/platform/crm/store';
import { useLiveCrmRecords } from '@/platform/crm/useLiveCrmRecords';
import {
  buildCapacityTriage,
  dailyWorkReason,
  nextRecurringDue,
  type DailyWorkItem,
} from '@/platform/crm/tasks';
import {
  createMigrationExport,
  runWealthboxMigration,
} from '@/platform/crm/migration';
import { crmHomeSurfaceRegistry } from './registry';
import { CrmHomeSurfaceContext } from './surfaceContext';
import type { LiveCrmRecord } from '@/platform/crm/liveRecords';
import {
  addWorkflowStepNote,
  applyWorkflowOffer,
  completeWorkflowStep,
  createMeetingWorkflowProposal,
  createTemplate,
  decideOffer,
  offerForInstance,
  publishTemplateUpdate,
  renameWorkflowStepLocally,
  startScheduledWorkflows,
  startWorkflow,
  stepValue,
  undoWorkflowApply,
  updateWorkflowTemplate,
  workflowRecords,
  type LiveWorkflowInstance,
  type LiveWorkflowOffer,
  type WorkflowScheduleDraft,
  type WorkflowStepOutcomeDraft,
} from './workflowLive';
import { STARTER_WORKFLOWS } from '@/features/crm-workflows-library';
import type {
  CrmFreshnessState,
  CrmHomeAdapter,
  CrmTask,
  CrmApproval,
  CrmActivity,
  CrmTaskSavedView,
  CrmFirmMember,
  CrmWorkflowWorkItem,
  AttachmentAccountingRecord,
  ExportJobStatus,
  MigrationFidelityReport,
  MigrationNoteGap,
  MigrationWorkflowChecklist,
  OfferDecision,
  PropagationOffer,
  PropagationApplyOffer,
} from './types';

export type CrmHomeRoute =
  | 'today'
  | 'tasks'
  | 'workflows'
  | 'propagation'
  | 'pipeline'
  | 'pipeline-settings'
  | 'reports'
  | 'activity'
  | 'views'
  | 'firm-setup'
  | 'fields-tags'
  | 'intake-links'
  | 'migration'
  | 'fidelity'
  | 'workflow-recreation'
  | 'attachment-accounting'
  | 'archive-export'
  | 'rollback-export'
  | 'search'
  | 'email'
  | 'calendar'
  | 'timeline';

export interface CrmHomeProps {
  adapter?: CrmHomeAdapter;
  initialRoute?: CrmHomeRoute;
  /** Sample records are visual-test-only and always visibly labelled. */
  preview?: boolean;
}

const PREVIEW_OFFERS: readonly PropagationOffer[] = [
  {
    id: 'offer-henderson',
    instanceId: 'winst-henderson',
    householdLabel: 'Henderson household',
    revisionLabel: 'Welcome sequence refresh',
    state: 'ready',
    steps: [
      {
        id: 'step-confirm-transfer',
        label: 'Confirm recurring transfer',
        changeKind: 'modify',
        protectedProgress: {
          status: 'todo',
          hasNotes: false,
          hasCompletion: false,
          hasOutcome: false,
          hasAssignmentHistory: false,
        },
        decisions: [
          {
            id: 'decision-due',
            revisionId: 'rev-welcome-refresh',
            stepId: 'step-confirm-transfer',
            field: 'due_offset',
            label: 'Due offset',
            before: '+0 days',
            after: '+4 days',
            decision: 'accepted',
            reofferState: 'original',
          },
          {
            id: 'decision-role',
            revisionId: 'rev-welcome-refresh',
            stepId: 'step-confirm-transfer',
            field: 'default_assignee_role',
            label: 'Default assignee role',
            before: 'CSA',
            after: 'Operations',
            decision: 'accepted',
            reofferState: 'original',
          },
        ],
      },
      {
        id: 'step-paper-kit',
        label: 'Paper welcome kit',
        changeKind: 'remove',
        protectedProgress: {
          status: 'todo',
          hasNotes: false,
          hasCompletion: false,
          hasOutcome: false,
          hasAssignmentHistory: false,
        },
        decisions: [
          {
            id: 'decision-remove',
            revisionId: 'rev-welcome-refresh',
            stepId: 'step-paper-kit',
            field: 'title',
            label: 'Remove untouched step',
            after: 'Untouched step will be removed',
            decision: 'accepted',
            reofferState: 'original',
          },
        ],
      },
    ],
  },
  {
    id: 'offer-miller',
    instanceId: 'winst-miller',
    householdLabel: 'Miller household',
    revisionLabel: 'Welcome sequence refresh',
    state: 'needs-decision',
    steps: [
      {
        id: 'step-send-packet',
        label: 'Send welcome packet',
        changeKind: 'modify',
        protectedProgress: {
          status: 'in_progress',
          hasNotes: true,
          hasCompletion: false,
          hasOutcome: false,
          hasAssignmentHistory: true,
        },
        decisions: [
          {
            id: 'decision-conflict',
            revisionId: 'rev-welcome-refresh-a',
            stepId: 'step-send-packet',
            field: 'due_offset',
            label: 'Due offset',
            before: '+2 days',
            after: '+4 days',
            decision: 'review_required',
            reofferState: 'original',
          },
        ],
        newAssignmentOffer: {
          id: 'assignment-miller',
          stepId: 'step-send-packet',
          assigneeLabel: 'Operations for future routing',
          decision: 'review_required',
        },
      },
    ],
  },
];

const PREVIEW_MIGRATION = {
  workflowChecklists: [
    {
      id: 'workflow-henderson',
      clientLabel: 'Henderson household',
      sourceTemplateLabel: 'Annual review',
      activityEvidence: [
        'Activity: review due',
        'Legacy Project: Annual review',
      ],
      availableSteps: ['Prepare review', 'Confirm meeting', 'Complete review'],
      decision: 'pending' as const,
    },
  ],
  attachmentAccounting: [
    {
      id: 'attachment-henderson',
      clientLabel: 'Henderson household',
      status: 'pending' as const,
    },
  ],
  exports: [
    {
      kind: 'archive' as const,
      status: 'ready' as const,
      manifestId: 'manifest_preview_001',
    },
    { kind: 'rollback' as const, status: 'ready' as const },
  ],
};

const PREVIEW_ADAPTER: CrmHomeAdapter = {
  freshness: { kind: 'offline' },
  tasks: [],
  offers: PREVIEW_OFFERS,
  migration: PREVIEW_MIGRATION,
  actions: {
    updateTask: () => undefined,
    applyPropagation: () => undefined,
    undoPropagation: () => ({ restored: 0, protectedCells: [] }),
    markNotificationsRead: () => undefined,
    recordWorkflowChecklist: () => undefined,
    recordAttachmentAccounting: () => undefined,
    createExport: () => undefined,
    retryExport: () => undefined,
  },
};

function emptyEngineAdapter(freshness: CrmFreshnessState): CrmHomeAdapter {
  return {
    freshness,
    tasks: [],
    approvals: [],
    activity: [],
    savedTaskViews: [],
    offers: [],
    migration: {
      workflowChecklists: [],
      attachmentAccounting: [],
      exports: [],
    },
    actions: {},
  };
}

const panelStyle = {
  border: '1px solid var(--kp-border)',
  borderRadius: 'var(--radius-lg)',
  background: 'var(--kp-surface)',
  padding: 'var(--kp-space-md)',
} as const;
const mutedStyle = {
  color: 'var(--kp-text-faint)',
  fontSize: 'var(--kp-font-sm)',
} as const;

function FreshnessBanner({ freshness }: { freshness: CrmFreshnessState }) {
  const marker =
    freshness.kind === 'live'
      ? '● Live'
      : freshness.kind === 'syncing'
        ? '◌ Syncing'
        : freshness.kind === 'offline'
          ? '☁ Working offline'
          : freshness.kind === 'last-synced'
            ? '● Last synced'
            : '● Needs attention';
  const color =
    freshness.kind === 'live'
      ? 'var(--kp-local)'
      : freshness.kind === 'syncing'
        ? 'var(--kp-assured)'
        : freshness.kind === 'offline'
          ? 'var(--color-slate-500)'
          : freshness.kind === 'last-synced'
            ? 'var(--kp-direct)'
            : 'var(--kp-danger)';
  const detail =
    freshness.kind === 'syncing'
      ? `Showing at least the changes received through ${freshness.lastSyncedAt ?? 'the last update'}; newer changes may still arrive.`
      : freshness.kind === 'offline'
        ? 'Local edits work. Delivery waits until you reconnect.'
        : freshness.kind === 'last-synced'
          ? `Last synced ${freshness.lastSyncedAt ?? 'previously'} · Full check: ${freshness.lastFullCheckAt ?? 'not available'}`
          : freshness.kind === 'error'
            ? (freshness.error ??
              'A specific connection check needs attention. Your readable local data remains available.')
            : 'Every contributing subscription has caught up.';
  return (
    <div
      data-testid="crm-freshness-banner"
      role="status"
      style={{
        ...panelStyle,
        padding: 'var(--kp-space-sm)',
        borderColor: color,
        display: 'flex',
        gap: 'var(--kp-space-sm)',
        alignItems: 'center',
        flexWrap: 'wrap',
      }}
    >
      <strong style={{ color }}>{marker}</strong>
      <span style={mutedStyle}>{detail}</span>
    </div>
  );
}

function AskBar({ scope = 'the firm' }: { scope?: string }) {
  return (
    <label
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        minWidth: 260,
        border: '1px solid var(--kp-border)',
        borderRadius: 8,
        padding: '7px 10px',
        background: 'white',
      }}
    >
      <span aria-hidden="true">✦</span>
      <input
        data-testid="crm-ask-input"
        aria-label={`Ask ${scope}`}
        placeholder={`Ask ${scope}…`}
        style={{
          border: 0,
          outline: 0,
          width: '100%',
          font: 'inherit',
          background: 'transparent',
        }}
      />
    </label>
  );
}

function HomeRail({
  route,
  onNavigate,
}: {
  route: CrmHomeRoute;
  onNavigate: (route: CrmHomeRoute) => void;
}) {
  const activeParent =
    route.startsWith('firm') ||
    route === 'fields-tags' ||
    route === 'intake-links' ||
    route.includes('migration') ||
    route.includes('fidelity') ||
    route.includes('export') ||
    route === 'workflow-recreation' ||
    route === 'attachment-accounting'
      ? 'firm-setup'
      : route === 'propagation'
        ? 'workflows'
        : route === 'pipeline-settings'
          ? 'pipeline'
          : route;
  return (
    <aside
      aria-label="Home sections"
      style={{
        width: 184,
        padding: 'var(--kp-space-md)',
        borderRight: '1px solid var(--kp-border)',
        background: 'var(--color-slate-50)',
        flex: 'none',
      }}
    >
      <div
        style={{ fontWeight: 700, color: 'var(--kp-navy)', marginBottom: 10 }}
      >
        Home
      </div>
      {crmHomeSurfaceRegistry
        .filter(({ rail }) => rail)
        .map(({ route: item, label, icon: Icon }) => (
          <button
            key={item}
            data-testid={`crm-home-nav-${item}`}
            onClick={() => {
              onNavigate(item);
            }}
            aria-current={activeParent === item ? 'page' : undefined}
            style={{
              display: 'flex',
              width: '100%',
              alignItems: 'center',
              gap: 8,
              border: 0,
              borderRadius: 7,
              padding: '8px 9px',
              marginBottom: 3,
              cursor: 'pointer',
              textAlign: 'left',
              background:
                activeParent === item ? 'var(--kp-assured-bg)' : 'transparent',
              color:
                activeParent === item ? 'var(--kp-assured)' : 'var(--kp-text)',
            }}
          >
            <Icon size={16} />
            {label}
          </button>
        ))}
    </aside>
  );
}

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}
type CrmDailyWorkItem =
  | (CrmTask & DailyWorkItem & { kind: 'task' })
  | (CrmWorkflowWorkItem & DailyWorkItem & { kind: 'workflow_step' });
function dailyWorkItems(
  tasks: readonly CrmTask[],
  workflowWorkItems: readonly CrmWorkflowWorkItem[]
): CrmDailyWorkItem[] {
  return [
    ...tasks.map((task) => ({ ...task, kind: 'task' as const })),
    ...workflowWorkItems.map((item) => ({
      ...item,
      kind: 'workflow_step' as const,
    })),
  ];
}
function workLabel(item: CrmDailyWorkItem): string {
  return item.kind === 'workflow_step' ? 'Workflow step' : 'Task';
}
function workHousehold(item: CrmDailyWorkItem): string | undefined {
  return item.householdLabel;
}

function Today({
  workItems,
  firmMembers,
  approvals,
  activity,
  freshness,
  onNavigate,
  onCompleteWorkItem,
  onDecideApproval,
}: {
  workItems: readonly CrmDailyWorkItem[];
  firmMembers: readonly CrmFirmMember[];
  approvals: readonly CrmApproval[];
  activity: readonly CrmActivity[];
  freshness: CrmFreshnessState;
  onNavigate: (r: CrmHomeRoute) => void;
  onCompleteWorkItem: (item: CrmDailyWorkItem) => void | Promise<void>;
  onDecideApproval: (
    approval: CrmApproval,
    decision: 'approved' | 'rejected'
  ) => void | Promise<void>;
}) {
  const [reviewing, setReviewing] = useState(false);
  const today = todayKey();
  const plan = buildCapacityTriage(
    workItems,
    firmMembers.map((member) => member.userId),
    today
  );
  const open = plan.ranked;
  const pendingApprovals = approvals.filter(
    (approval) => approval.state === 'pending'
  );
  const recentActivity = [...activity]
    .sort((left, right) => right.at.localeCompare(left.at))
    .slice(0, 6);
  return (
    <Screen
      title="Today"
      description="Your morning plan"
      Icon={LayoutDashboard}
      action={
        <Button
          data-testid="crm-today-review"
          iconLeft={ClipboardList}
          onClick={() => {
            setReviewing(true);
          }}
        >
          Review today’s plan
        </Button>
      }
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          gap: 12,
          flexWrap: 'wrap',
        }}
      >
        <AskBar />
        <FreshnessBanner freshness={freshness} />
      </div>
      {open.length === 0 ? (
        <section data-testid="crm-today-first-use" style={panelStyle}>
          <strong>Your firm is ready to set up Today.</strong>
          <p style={mutedStyle}>
            Add tasks or finish your import, and the work that needs attention
            first will appear here.
          </p>
          <div style={{ display: 'flex', gap: 8 }}>
            <Button
              data-testid="crm-today-new-task"
              onClick={() => {
                onNavigate('tasks');
              }}
            >
              New task
            </Button>
            <Button
              variant="secondary"
              data-testid="crm-today-open-migration"
              onClick={() => {
                onNavigate('migration');
              }}
            >
              Open migration
            </Button>
          </div>
        </section>
      ) : (
        <section data-testid="crm-today-triage" style={panelStyle}>
          <strong>What needs attention first</strong>
          <p style={mutedStyle}>
            Ordered from your saved tasks and workflow steps. Each item explains
            why it is here.
          </p>
          {open.map((item) => (
            <div
              key={item.id}
              data-testid={`crm-today-task-${item.id}`}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                gap: 8,
                padding: '10px 0',
                borderTop: '1px solid var(--kp-border)',
              }}
            >
              <span>
                <strong>{item.title}</strong>
                <span style={mutedStyle}>
                  {' '}
                  · {dailyWorkReason(item, today)} · {workLabel(item)}
                  {workHousehold(item) ? ` · ${workHousehold(item)}` : ''}
                </span>
              </span>
              <Button
                size="sm"
                variant="secondary"
                data-testid={`crm-today-complete-${item.id}`}
                onClick={() => {
                  void onCompleteWorkItem(item);
                }}
              >
                Complete
              </Button>
            </div>
          ))}
          <Button
            variant="secondary"
            data-testid="crm-today-review-inline"
            onClick={() => {
              setReviewing(true);
            }}
          >
            Review this order
          </Button>
        </section>
      )}
      {reviewing && (
        <section
          data-testid="crm-today-review-panel"
          style={{ ...panelStyle, borderColor: 'var(--kp-assured)' }}
        >
          <strong>How Today is ordered</strong>
          <p style={mutedStyle}>
            Work with a date comes first, with overdue work first. Then Lantern
            puts blocked work and high-priority work ahead of other open items.
            It only uses saved CRM records and never moves work by itself.
          </p>
          {open.length === 0 ? (
            <p style={mutedStyle}>
              Add a task or finish your import to start a plan.
            </p>
          ) : (
            open.map((item) => (
              <div
                key={item.id}
                style={{
                  display: 'flex',
                  gap: 8,
                  justifyContent: 'space-between',
                  padding: '8px 0',
                  borderTop: '1px solid var(--kp-border)',
                }}
              >
                <span>
                  {item.title}
                  <span style={mutedStyle}>
                    {' '}
                    · {dailyWorkReason(item, today)}
                  </span>
                </span>
                <Button
                  size="sm"
                  variant="secondary"
                  data-testid={`crm-today-keep-${item.id}`}
                  onClick={() => undefined}
                >
                  Keep in Today
                </Button>
              </div>
            ))
          )}
        </section>
      )}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: 12,
        }}
      >
        <section data-testid="crm-approval-queue" style={panelStyle}>
          <strong>Waiting for you</strong>
          <p style={mutedStyle}>
            {pendingApprovals.length === 0
              ? 'No approvals are waiting.'
              : `${String(pendingApprovals.length)} approval${pendingApprovals.length === 1 ? '' : 's'} waiting.`}
          </p>
          {pendingApprovals.map((approval) => (
            <div
              key={approval.id}
              data-testid={`crm-approval-${approval.id}`}
              style={{
                borderTop: '1px solid var(--kp-border)',
                paddingTop: 8,
                marginTop: 8,
              }}
            >
              <strong>{approval.title}</strong>
              {approval.householdLabel && (
                <span style={mutedStyle}> · {approval.householdLabel}</span>
              )}
              <p style={mutedStyle}>
                {approval.rationale ?? 'Review this proposed change.'}
              </p>
              <Button
                size="sm"
                data-testid={`crm-approval-approve-${approval.id}`}
                onClick={() => {
                  void onDecideApproval(approval, 'approved');
                }}
              >
                Approve
              </Button>
              <Button
                size="sm"
                variant="secondary"
                data-testid={`crm-approval-dismiss-${approval.id}`}
                style={{ marginLeft: 8 }}
                onClick={() => {
                  void onDecideApproval(approval, 'rejected');
                }}
              >
                Dismiss
              </Button>
            </div>
          ))}
          {approvals.some((approval) => approval.state !== 'pending') && (
            <p data-testid="crm-approval-history" style={mutedStyle}>
              Decided proposals stay in history and can be reviewed later.
            </p>
          )}
          <Button
            variant="secondary"
            size="sm"
            data-testid="crm-today-open-propagation"
            onClick={() => {
              onNavigate('propagation');
            }}
          >
            Review workflow updates
          </Button>
        </section>
        <section data-testid="crm-recent-activity" style={panelStyle}>
          <strong>Recent firm activity</strong>
          {recentActivity.length === 0 ? (
            <p style={mutedStyle}>No recorded activity yet.</p>
          ) : (
            recentActivity.map((event) => (
              <p
                key={event.id}
                data-testid={`crm-activity-${event.id}`}
                style={mutedStyle}
              >
                {event.summary} · {new Date(event.at).toLocaleString()}
              </p>
            ))
          )}
        </section>
      </div>
    </Screen>
  );
}

function Tasks({
  tasks,
  workflowWorkItems,
  firmMembers,
  households,
  savedViews,
  freshness,
  onUpdateTask,
  onCompleteWorkflowWorkItem,
  onSaveView,
}: {
  tasks: readonly CrmTask[];
  workflowWorkItems: readonly CrmWorkflowWorkItem[];
  firmMembers: readonly CrmFirmMember[];
  households: readonly { id: string; name: string }[];
  savedViews: readonly CrmTaskSavedView[];
  freshness: CrmFreshnessState;
  onUpdateTask: (task: CrmTask) => void | Promise<void>;
  onCompleteWorkflowWorkItem: (
    item: CrmWorkflowWorkItem
  ) => void | Promise<void>;
  onSaveView: (view: CrmTaskSavedView) => void | Promise<void>;
}) {
  const [view, setView] = useState<'list' | 'board'>('list');
  const [filter, setFilter] = useState('');
  const [editing, setEditing] = useState<CrmTask | null>(null);
  const [savingView, setSavingView] = useState(false);
  const [viewName, setViewName] = useState('');
  const filtered = tasks.filter((task) =>
    task.title.toLowerCase().includes(filter.toLowerCase())
  );
  const filteredWorkflowSteps = workflowWorkItems.filter((item) =>
    item.title.toLowerCase().includes(filter.toLowerCase())
  );
  const workItems = dailyWorkItems(filtered, filteredWorkflowSteps);
  const plan = buildCapacityTriage(
    dailyWorkItems(tasks, workflowWorkItems),
    firmMembers.map((member) => member.userId)
  );
  const advance = (task: CrmTask) => {
    void onUpdateTask({
      ...task,
      status: task.status === 'done' ? 'open' : 'done',
    });
  };
  const newTask = () => {
    setEditing({
      id: `new-task-${crypto.randomUUID()}`,
      title: '',
      body: '',
      assigneeUserId: null,
      status: 'open',
      priority: 'normal',
      contextRefs: [],
    });
  };
  return (
    <Screen
      title="Tasks"
      description="One work list for tasks and workflow steps"
      Icon={ListChecks}
      action={
        <Button data-testid="crm-task-new" iconLeft={Plus} onClick={newTask}>
          New task
        </Button>
      }
    >
      <div
        style={{
          display: 'flex',
          gap: 8,
          flexWrap: 'wrap',
          alignItems: 'center',
        }}
      >
        <AskBar />
        <button
          data-testid="crm-task-list-view"
          onClick={() => {
            setView('list');
          }}
          aria-pressed={view === 'list'}
        >
          List
        </button>
        <button
          data-testid="crm-task-board-view"
          onClick={() => {
            setView('board');
          }}
          aria-pressed={view === 'board'}
        >
          Board
        </button>
        <input
          data-testid="crm-task-search"
          aria-label="Search tasks"
          value={filter}
          onChange={(event) => {
            setFilter(event.target.value);
          }}
          placeholder="Search tasks"
        />{' '}
        <Button
          variant="secondary"
          size="sm"
          data-testid="crm-task-save-view-open"
          onClick={() => {
            setSavingView(true);
          }}
        >
          Save view
        </Button>
      </div>
      {savingView && (
        <section style={panelStyle}>
          <label>
            Saved view name{' '}
            <input
              data-testid="crm-task-view-name"
              value={viewName}
              onChange={(event) => {
                setViewName(event.target.value);
              }}
            />
          </label>
          <Button
            data-testid="crm-task-save-view"
            disabled={!viewName.trim()}
            style={{ marginLeft: 8 }}
            onClick={() => {
              void (async () => {
                await onSaveView({
                  id: `saved-view-${crypto.randomUUID()}`,
                  name: viewName.trim(),
                  layout: view === 'board' ? 'kanban' : 'list',
                  ...(filter ? { search: filter } : {}),
                });
                setSavingView(false);
                setViewName('');
              })();
            }}
          >
            Save
          </Button>
        </section>
      )}
      {savedViews.length > 0 && (
        <section data-testid="crm-task-saved-views" style={panelStyle}>
          <strong>Saved views</strong>
          {savedViews.map((saved) => (
            <Button
              key={saved.id}
              size="sm"
              variant="secondary"
              data-testid={`crm-task-view-${saved.id}`}
              style={{ marginLeft: 8 }}
              onClick={() => {
                setView(saved.layout === 'kanban' ? 'board' : 'list');
                setFilter(saved.search ?? '');
              }}
            >
              {saved.name}
            </Button>
          ))}
        </section>
      )}
      {tasks.length === 0 && workflowWorkItems.length === 0 && (
        <section data-testid="crm-tasks-first-use" style={panelStyle}>
          <strong>No work yet.</strong>
          <p style={mutedStyle}>
            Create a task or start a workflow. A task can be for one client or
            the whole firm.
          </p>
        </section>
      )}
      <section data-testid="crm-task-triage-count" style={panelStyle}>
        <strong>
          {plan.hasCapacitySignal
            ? `${String(plan.fitsToday.length)} of ${String(plan.ranked.length)} open items fit the first daily plan.`
            : 'Add active firm members to make a capacity-based daily plan.'}
        </strong>
      </section>
      <FreshnessBanner freshness={freshness} />
      {view === 'list' ? (
        <div data-testid="crm-task-list" style={panelStyle}>
          {workItems.length === 0 ? (
            <p>
              {tasks.length === 0 && workflowWorkItems.length === 0
                ? 'No work yet.'
                : 'No work matches these filters.'}
            </p>
          ) : (
            <>
              {filtered.map((task) => (
                <TaskRow
                  key={task.id}
                  task={task}
                  onComplete={() => {
                    advance(task);
                  }}
                  onOpen={() => {
                    setEditing(task);
                  }}
                />
              ))}
              {filteredWorkflowSteps.map((item) => (
                <WorkflowWorkRow
                  key={item.id}
                  item={item}
                  onComplete={() => {
                    void onCompleteWorkflowWorkItem(item);
                  }}
                />
              ))}
            </>
          )}
        </div>
      ) : (
        <TaskBoard
          tasks={filtered}
          onOpen={setEditing}
          onMove={(task, status) => {
            void onUpdateTask({ ...task, status });
          }}
        />
      )}
      {editing && (
        <TaskDetail
          task={editing}
          households={households}
          firmMembers={firmMembers}
          onClose={() => {
            setEditing(null);
          }}
          onSave={onUpdateTask}
        />
      )}
    </Screen>
  );
}

function TaskRow({
  task,
  onComplete,
  onOpen,
}: {
  task: CrmTask;
  onComplete: () => void;
  onOpen: () => void;
}) {
  return (
    <div
      style={{
        display: 'flex',
        gap: 10,
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '10px 0',
        borderBottom: '1px solid var(--kp-border)',
      }}
    >
      <button
        data-testid={`crm-task-complete-${task.id}`}
        aria-label={`Complete ${task.title}`}
        onClick={onComplete}
      >
        {task.status === 'done' ? '✓' : '□'}
      </button>
      <button
        data-testid={`crm-task-open-${task.id}`}
        onClick={onOpen}
        style={{
          background: 'transparent',
          border: 0,
          textAlign: 'left',
          flex: 1,
          cursor: 'pointer',
        }}
      >
        <strong>{task.title}</strong>
        <span style={mutedStyle}>
          {' '}
          · {task.householdLabel ?? 'No client'} · {task.priority} ·{' '}
          {task.dueLabel ?? 'No due date'} ·{' '}
          {task.assigneeLabel ?? task.assigneeUserId ?? 'Unassigned'}
          {task.recurrence ? ' · Recurring' : ''}
        </span>
      </button>
    </div>
  );
}

function WorkflowWorkRow({
  item,
  onComplete,
}: {
  item: CrmWorkflowWorkItem;
  onComplete: () => void;
}) {
  return (
    <div
      data-testid={`crm-workflow-work-${item.id}`}
      style={{
        display: 'flex',
        gap: 10,
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '10px 0',
        borderBottom: '1px solid var(--kp-border)',
      }}
    >
      <button
        data-testid={`crm-workflow-work-complete-${item.id}`}
        aria-label={`Complete ${item.title}`}
        onClick={onComplete}
      >
        □
      </button>
      <span style={{ flex: 1 }}>
        <strong>{item.title}</strong>
        <span style={mutedStyle}>
          {' '}
          · Workflow step · {item.householdLabel} ·{' '}
          {item.assigneeLabel ?? item.assigneeUserId ?? 'Unassigned'}
        </span>
      </span>
    </div>
  );
}

function TaskBoard({
  tasks,
  onOpen,
  onMove,
}: {
  tasks: readonly CrmTask[];
  onOpen: (task: CrmTask) => void;
  onMove: (task: CrmTask, status: CrmTask['status']) => void;
}) {
  const columns: readonly [CrmTask['status'], string][] = [
    ['open', 'To do'],
    ['in_progress', 'In progress'],
    ['blocked', 'Blocked'],
    ['done', 'Done'],
  ];
  return (
    <div
      data-testid="crm-task-board"
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(4, minmax(180px, 1fr))',
        gap: 10,
        overflowX: 'auto',
      }}
    >
      {columns.map(([status, label]) => (
        <section key={status} style={panelStyle}>
          <strong>{label}</strong>
          {tasks
            .filter((task) => task.status === status)
            .map((task) => (
              <button
                key={task.id}
                data-testid={`crm-task-board-${task.id}`}
                onClick={() => {
                  onOpen(task);
                }}
                onDoubleClick={() => {
                  onMove(task, status === 'done' ? 'open' : 'done');
                }}
                style={{
                  display: 'block',
                  width: '100%',
                  marginTop: 8,
                  padding: 8,
                  textAlign: 'left',
                  border: '1px solid var(--kp-border)',
                  borderRadius: 6,
                  background: 'white',
                }}
              >
                {task.title}
              </button>
            ))}
        </section>
      ))}
    </div>
  );
}

function TaskDetail({
  task,
  households,
  firmMembers,
  onClose,
  onSave,
}: {
  task: CrmTask;
  households: readonly { id: string; name: string }[];
  firmMembers: readonly CrmFirmMember[];
  onClose: () => void;
  onSave: (task: CrmTask) => void | Promise<void>;
}) {
  const [draft, setDraft] = useState(task);
  const [saving, setSaving] = useState(false);
  const householdId = draft.householdId ?? draft.contextRefs?.[0] ?? '';
  const selectHousehold = (id: string) => {
    const household = households.find((item) => item.id === id);
    setDraft((current) => ({
      ...current,
      householdId: id || undefined,
      householdLabel: household?.name,
      contextRefs: id ? [id] : [],
    }));
  };
  const setRecurrence = (freq: string) => {
    setDraft((current) => ({
      ...current,
      recurrence: freq
        ? {
            freq: freq as NonNullable<CrmTask['recurrence']>['freq'],
            interval: current.recurrence?.interval ?? 1,
            regenerateOnComplete: true,
          }
        : undefined,
    }));
  };
  const recurrence = draft.recurrence;
  const save = async () => {
    setSaving(true);
    try {
      await onSave(draft);
      onClose();
    } finally {
      setSaving(false);
    }
  };
  return (
    <aside
      data-testid="crm-task-detail"
      aria-label="Task detail"
      style={{
        ...panelStyle,
        position: 'fixed',
        right: 20,
        top: 80,
        maxWidth: 420,
        boxShadow: 'var(--kp-shadow-2)',
        zIndex: 5,
        display: 'grid',
        gap: 8,
      }}
    >
      <h2 style={{ marginTop: 0 }}>Task detail</h2>
      <label>
        Title
        <input
          data-testid="crm-task-title-input"
          value={draft.title}
          onChange={(event) => {
            const title = event.target.value;
            setDraft((current) => ({ ...current, title }));
          }}
        />
      </label>
      <label>
        Notes
        <textarea
          data-testid="crm-task-body"
          value={draft.body ?? ''}
          onChange={(event) => {
            const body = event.target.value;
            setDraft((current) => ({ ...current, body }));
          }}
        />
      </label>
      <label>
        Client
        <select
          data-testid="crm-task-household"
          value={householdId}
          onChange={(event) => {
            selectHousehold(event.target.value);
          }}
        >
          <option value="">Whole firm</option>
          {households.map((household) => (
            <option key={household.id} value={household.id}>
              {household.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Assignee
        <select
          data-testid="crm-task-assignee"
          value={draft.assigneeUserId ?? ''}
          onChange={(event) => {
            const member = firmMembers.find(
              (item) => item.userId === event.target.value
            );
            setDraft((current) => ({
              ...current,
              assigneeUserId: member?.userId ?? null,
              assigneeLabel: member?.displayName,
            }));
          }}
        >
          <option value="">Unassigned</option>
          {firmMembers.map((member) => (
            <option key={member.userId} value={member.userId}>
              {member.displayName}
              {member.title ? ` · ${member.title}` : ''}
            </option>
          ))}
        </select>
      </label>
      {firmMembers.length === 0 && (
        <p data-testid="crm-task-no-members" style={mutedStyle}>
          No active firm members are available to assign yet.
        </p>
      )}
      <label>
        Status
        <select
          data-testid="crm-task-status"
          value={draft.status}
          onChange={(event) => {
            const status = event.target.value as CrmTask['status'];
            setDraft((current) => ({ ...current, status }));
          }}
        >
          <option value="open">To do</option>
          <option value="in_progress">In progress</option>
          <option value="blocked">Blocked</option>
          <option value="done">Done</option>
        </select>
      </label>
      <label>
        Priority
        <select
          data-testid="crm-task-priority"
          value={draft.priority}
          onChange={(event) => {
            const priority = event.target.value as CrmTask['priority'];
            setDraft((current) => ({ ...current, priority }));
          }}
        >
          <option value="high">High</option>
          <option value="normal">Normal</option>
          <option value="low">Low</option>
        </select>
      </label>
      <label>
        Due date
        <input
          data-testid="crm-task-due"
          type="date"
          value={draft.dueAt ?? ''}
          onChange={(event) => {
            const due = event.target.value;
            setDraft((current) => ({
              ...current,
              dueAt: due || undefined,
              dueLabel: due || undefined,
            }));
          }}
        />
      </label>
      <label>
        Repeat
        <select
          data-testid="crm-task-recurrence"
          value={recurrence?.freq ?? ''}
          onChange={(event) => {
            setRecurrence(event.target.value);
          }}
        >
          <option value="">Does not repeat</option>
          <option value="daily">Daily</option>
          <option value="weekly">Weekly</option>
          <option value="monthly">Monthly</option>
          <option value="yearly">Yearly</option>
        </select>
      </label>
      {recurrence && (
        <label>
          Every{' '}
          <input
            data-testid="crm-task-recurrence-interval"
            type="number"
            min="1"
            value={recurrence.interval}
            onChange={(event) => {
              setDraft((current) => ({
                ...current,
                recurrence: {
                  ...(current.recurrence ?? recurrence),
                  interval: Math.max(1, Number(event.target.value) || 1),
                },
              }));
            }}
          />
        </label>
      )}
      <p style={mutedStyle}>
        One assignee. Notes live in the task body. Tasks have no comments.
      </p>
      <div style={{ display: 'flex', gap: 8 }}>
        <Button
          data-testid="crm-task-save"
          disabled={saving || !draft.title.trim()}
          onClick={() => {
            void save();
          }}
        >
          {saving ? 'Saving…' : 'Save local change'}
        </Button>
        <Button variant="secondary" onClick={onClose}>
          Close
        </Button>
      </div>
    </aside>
  );
}

function Workflows({
  freshness,
  onNavigate,
}: {
  freshness: CrmFreshnessState;
  onNavigate: (route: CrmHomeRoute) => void;
}) {
  return (
    <Screen
      title="Workflows"
      description="Steps your firm follows for each household"
      Icon={Workflow}
      action={undefined}
    >
      <FreshnessBanner freshness={freshness} />
      <section style={panelStyle}>
        <strong>No workflow records are connected to this view.</strong>
        <p style={mutedStyle}>
          Open the live CRM workspace to create a workflow and review its
          household updates. Lantern will not show made-up workflow counts here.
        </p>
        <Button
          variant="secondary"
          data-testid="crm-workflow-review"
          onClick={() => {
            onNavigate('propagation');
          }}
        >
          Review workflow updates
        </Button>
      </section>
    </Screen>
  );
}

function PropagationReview({
  offers,
  freshness,
  onApply,
  onUndo,
  undoReport,
}: {
  offers: readonly PropagationOffer[];
  freshness: CrmFreshnessState;
  onApply: (offers: readonly PropagationApplyOffer[]) => void;
  onUndo: () => void;
  undoReport: string | null;
}) {
  const [draft, setDraft] = useState<readonly PropagationOffer[]>(offers);
  const [outcome, setOutcome] = useState<string | null>(null);
  const decisions = (current: readonly PropagationOffer[]) =>
    current.flatMap((offer) => offer.steps.flatMap((step) => step.decisions));
  const unresolved = decisions(draft).filter(
    (decision) => decision.decision === 'review_required'
  );
  const eligible = draft.filter(
    (offer) =>
      offer.state === 'ready' &&
      !offer.steps.some((step) =>
        step.decisions.some(
          (decision) => decision.decision === 'review_required'
        )
      )
  );
  const setDecision = (
    offerId: string,
    decisionId: string,
    decision: OfferDecision['decision']
  ) => {
    setDraft((current) =>
      current.map((offer) =>
        offer.id !== offerId
          ? offer
          : {
              ...offer,
              steps: offer.steps.map((step) => ({
                ...step,
                decisions: step.decisions.map((item) =>
                  item.id === decisionId ? { ...item, decision } : item
                ),
              })),
            }
      )
    );
  };
  const approveAll = () => {
    setDraft((current) =>
      current.map((offer) =>
        offer.steps.some((step) =>
          step.decisions.some(
            (decision) => decision.decision === 'review_required'
          )
        )
          ? offer
          : {
              ...offer,
              steps: offer.steps.map((step) => ({
                ...step,
                decisions: step.decisions.map((decision) => ({
                  ...decision,
                  decision: 'accepted' as const,
                })),
              })),
            }
      )
    );
  };
  const apply = () => {
    if (unresolved.length) {
      setOutcome(
        'Choose keep or apply for every change before continuing. Nothing was changed.'
      );
      return;
    }
    const payload = draft.map((offer) => ({
      offerId: offer.id,
      instanceId: offer.instanceId,
      acceptedDecisions: offer.steps.flatMap((step) =>
        step.decisions
          .filter((decision) => decision.decision === 'accepted')
          .map(({ id, revisionId, stepId, field, reofferState }) => ({
            id,
            revisionId,
            stepId,
            field,
            reofferState,
          }))
      ),
    }));
    onApply(payload);
    setOutcome(
      `${String(payload.flatMap((offer) => offer.acceptedDecisions).length)} workflow change${payload.flatMap((offer) => offer.acceptedDecisions).length === 1 ? '' : 's'} are ready to apply. Completed work and notes will not change.`
    );
  };
  const reportUndo = () => {
    onUndo();
  };
  return (
    <Screen
      title="Workflow update review"
      description="Choose how a template update should affect open household work"
      Icon={GitPullRequest}
      action={
        <Button
          data-testid="crm-propagation-approve-all"
          disabled={
            freshness.kind === 'offline' ||
            freshness.kind === 'syncing' ||
            freshness.kind === 'last-synced'
          }
          onClick={approveAll}
        >
          Apply all clear changes
        </Button>
      }
    >
      <FreshnessBanner freshness={freshness} />
      {(freshness.kind === 'offline' || freshness.kind === 'last-synced') && (
        <div
          role="alert"
          style={{ ...panelStyle, borderColor: 'var(--kp-direct)' }}
        >
          {freshness.kind === 'offline'
            ? 'Reconnect before changing open household workflows. You can still read this review.'
            : 'Lantern is checking for the latest workflow updates before it can apply all of them.'}
        </div>
      )}
      {unresolved.length > 0 && (
        <div
          data-testid="crm-propagation-review-required"
          role="alert"
          style={{ ...panelStyle, borderColor: 'var(--kp-danger)' }}
        >
          Some changes need your choice. Compare each option, then choose Apply
          or Keep current.
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <span style={mutedStyle}>
          {draft.length} household{draft.length === 1 ? '' : 's'} to review
        </span>
        <span style={mutedStyle}>{eligible.length} ready</span>
        <span style={mutedStyle}>{unresolved.length} need your choice</span>
      </div>
      {draft.map((offer) => (
        <PropagationOfferCard
          key={offer.id}
          offer={offer}
          onDecision={setDecision}
        />
      ))}
      <footer
        style={{
          ...panelStyle,
          position: 'sticky',
          bottom: 0,
          display: 'flex',
          justifyContent: 'space-between',
          gap: 8,
          alignItems: 'center',
        }}
      >
        <span>
          {
            decisions(draft).filter(
              (decision) => decision.decision === 'accepted'
            ).length
          }{' '}
          change
          {decisions(draft).filter(
            (decision) => decision.decision === 'accepted'
          ).length === 1
            ? ''
            : 's'}{' '}
          ready across {draft.length} household{draft.length === 1 ? '' : 's'}
        </span>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button
            variant="secondary"
            data-testid="crm-propagation-undo"
            onClick={reportUndo}
          >
            Undo last update
          </Button>
          <Button
            data-testid="crm-propagation-apply"
            disabled={freshness.kind !== 'live' || unresolved.length > 0}
            onClick={apply}
          >
            Apply changes
          </Button>
        </div>
      </footer>
      {outcome && (
        <p data-testid="crm-propagation-result" role="status">
          {outcome}
        </p>
      )}
      {undoReport && (
        <p data-testid="crm-propagation-undo-report" role="status">
          {undoReport}
        </p>
      )}
    </Screen>
  );
}

function PropagationOfferCard({
  offer,
  onDecision,
}: {
  offer: PropagationOffer;
  onDecision: (
    offerId: string,
    decisionId: string,
    decision: OfferDecision['decision']
  ) => void;
}) {
  const changeCount = offer.steps.reduce(
    (count, step) => count + step.decisions.length,
    0
  );
  return (
    <section
      data-testid={`crm-propagation-offer-${offer.id}`}
      style={panelStyle}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
        <strong>{offer.householdLabel}: Template updated</strong>
        <span style={mutedStyle}>
          {changeCount} change{changeCount === 1 ? '' : 's'} to review
        </span>
      </div>
      <p style={mutedStyle}>
        Choose what should change next. Work already done and its notes stay as
        they are.
      </p>
      {offer.steps.map((step) => (
        <section
          key={step.id}
          data-testid={`crm-propagation-step-${step.id}`}
          style={{
            borderTop: '1px solid var(--kp-border)',
            marginTop: 10,
            paddingTop: 10,
          }}
        >
          <strong>{step.label}</strong>
          {step.decisions.map((decision) => (
            <PropagationFieldRow
              key={decision.id}
              decision={decision}
              onDecision={(choice) => {
                onDecision(offer.id, decision.id, choice);
              }}
            />
          ))}
          {step.newAssignmentOffer && (
            <p style={mutedStyle}>
              New work after this update will go to{' '}
              {step.newAssignmentOffer.assigneeLabel}. This does not change work
              already assigned.
            </p>
          )}
          <p style={mutedStyle}>
            {step.protectedProgress.status === 'completed'
              ? 'This step is complete. Its work and notes will not change.'
              : 'Any work already recorded on this step will stay as it is.'}
          </p>
        </section>
      ))}
      <details style={{ marginTop: 10 }}>
        <summary>Details for support</summary>
        <p style={mutedStyle}>
          Update: {offer.revisionLabel}. Record: {offer.id}. Step records:{' '}
          {offer.steps.map((step) => step.id).join(', ')}.
        </p>
      </details>
    </section>
  );
}

function PropagationFieldRow({
  decision,
  onDecision,
}: {
  decision: OfferDecision;
  onDecision: (decision: OfferDecision['decision']) => void;
}) {
  const sentence =
    decision.field === 'due_offset'
      ? `Move due date from ${decision.before ?? 'the current date'} to ${decision.after}`
      : decision.field === 'default_assignee_role'
        ? `Send new work from ${decision.before ?? 'the current person'} to ${decision.after}`
        : decision.field === 'title'
          ? `Rename this step${decision.before ? ` from ${decision.before}` : ''} to ${decision.after}`
          : decision.field === 'required'
            ? `${decision.after === 'true' ? 'Make this step required' : 'Make this step optional'}`
            : decision.field === 'description'
              ? 'Update the step instructions'
              : decision.field === 'order'
                ? `Move this step to ${decision.after}`
                : `${decision.label}: ${decision.before ? `${decision.before} to ` : ''}${decision.after}`;
  return (
    <div
      style={{ display: 'flex', gap: 8, padding: '8px 0', alignItems: 'start' }}
    >
      <span>
        <strong>{sentence}</strong>
        <br />
        <span style={mutedStyle}>
          This is a future-work change. Work already done will stay as it is.
        </span>
      </span>
      <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
        <Button
          size="sm"
          variant={decision.decision === 'accepted' ? 'primary' : 'secondary'}
          data-testid={`crm-propagation-accept-${decision.id}`}
          onClick={() => {
            onDecision('accepted');
          }}
        >
          Apply
        </Button>
        <Button
          size="sm"
          variant={decision.decision === 'rejected' ? 'primary' : 'secondary'}
          data-testid={`crm-propagation-reject-${decision.id}`}
          onClick={() => {
            onDecision('rejected');
          }}
        >
          Keep current
        </Button>
        {decision.decision === 'review_required' && (
          <span
            data-testid={`crm-propagation-unresolved-${decision.id}`}
            style={mutedStyle}
          >
            Choose one
          </span>
        )}
      </div>
    </div>
  );
}

type LiveWorkflowData = ReturnType<typeof workflowRecords>;
type HouseholdChoice = { id: string; label: string };
function displayValue(value: unknown): string {
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  )
    return String(value);
  return value === undefined || value === null ? '' : JSON.stringify(value);
}

function liveStepTitle(instance: LiveWorkflowInstance, stepId: string) {
  return (
    displayValue(stepValue(instance, stepId, 'title')) ||
    instance.snapshot.steps[stepId]?.titleSnapshot ||
    'Untitled step'
  );
}

function LiveWorkflows({
  data,
  households,
  onSave,
  onNavigate,
}: {
  data: LiveWorkflowData;
  households: readonly HouseholdChoice[];
  onSave: (record: LiveCrmRecord) => Promise<unknown>;
  onNavigate: (route: CrmHomeRoute) => void;
}) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [titles, setTitles] = useState(['', '', '']);
  const [newHousehold, setNewHousehold] = useState('');
  const [selectedHouseholdId, setSelectedHouseholdId] = useState('');
  const [editing, setEditing] = useState(false);
  const [changedTitle, setChangedTitle] = useState('');
  const [addedTitle, setAddedTitle] = useState('Send welcome summary');
  const [schedule, setSchedule] = useState<WorkflowScheduleDraft>({
    frequency: 'annual',
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    startsAt: new Date().toISOString().slice(0, 10),
    householdIds: [],
    enabled: false,
  });
  const [outcomes, setOutcomes] = useState<
    Record<string, WorkflowStepOutcomeDraft[]>
  >({});
  const [meetingId, setMeetingId] = useState('');
  const [meetingHouseholdId, setMeetingHouseholdId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const template = data.templates[0];
  const instances = template
    ? data.instances.filter((instance) => instance.templateId === template.id)
    : [];
  const save = async (record: LiveCrmRecord) => {
    try {
      setError(null);
      await onSave(record);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };
  const chooseStarter = (starter: (typeof STARTER_WORKFLOWS)[number]) => {
    setName(starter.name);
    setTitles([...starter.steps]);
    setCreating(true);
  };
  const create = async () => {
    await save(createTemplate(name, titles));
    setCreating(false);
  };
  const start = async () => {
    if (!template) return;
    let household = households.find((item) => item.id === selectedHouseholdId);
    if (!household) {
      const id = `household-${String(Date.now())}`;
      household = { id, label: newHousehold.trim() || 'New household' };
      await save({
        id,
        kind: 'household',
        matterId: id,
        name: household.label,
      });
    }
    await save(startWorkflow(template, household));
  };
  const publish = async () => {
    if (!template) return;
    try {
      setError(null);
      const update = publishTemplateUpdate(template, changedTitle, addedTitle);
      await onSave(
        updateWorkflowTemplate(update.template, { schedule, outcomes })
      );
      for (const instance of instances)
        await onSave(
          offerForInstance(
            update.template,
            instance,
            update.revisionId,
            update.label
          )
        );
      setEditing(false);
      onNavigate('propagation');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };
  const saveSettings = async () => {
    if (!template) return;
    await save(updateWorkflowTemplate(template, { schedule, outcomes }));
    setEditing(false);
  };
  const addOutcome = (stepId: string) =>
    setOutcomes((current) => ({
      ...current,
      [stepId]: [
        ...(current[stepId] ?? []),
        { id: `outcome-${stepId}-${Date.now()}`, label: '' },
      ],
    }));
  const editOutcome = (
    stepId: string,
    outcomeId: string,
    change: Partial<WorkflowStepOutcomeDraft>
  ) =>
    setOutcomes((current) => ({
      ...current,
      [stepId]: (current[stepId] ?? []).map((outcome) =>
        outcome.id === outcomeId ? { ...outcome, ...change } : outcome
      ),
    }));
  return (
    <Screen
      title="Workflows"
      description="Steps your firm follows for each household"
      Icon={Workflow}
      action={
        <Button
          data-testid="crm-live-workflow-new-template"
          iconLeft={Plus}
          onClick={() => {
            setCreating(true);
          }}
        >
          New template
        </Button>
      }
    >
      {error && (
        <div
          role="alert"
          style={{ ...panelStyle, borderColor: 'var(--kp-danger)' }}
        >
          {error}
        </div>
      )}
      {!template && !creating && (
        <>
          <section style={panelStyle}>
            <strong>No workflow templates yet</strong>
            <p style={mutedStyle}>
              Create your own set of steps, or start from a common firm
              workflow. Nothing is added until you choose one.
            </p>
            <Button
              data-testid="crm-live-workflow-create-first"
              onClick={() => {
                setCreating(true);
              }}
            >
              Create a workflow
            </Button>
          </section>
          <section data-testid="crm-live-workflow-library" style={panelStyle}>
            <strong>Starter workflow library</strong>
            <p style={mutedStyle}>
              These are editable starting points, not records in your firm.
            </p>
            {STARTER_WORKFLOWS.map((starter) => (
              <div
                key={starter.id}
                style={{
                  borderTop: '1px solid var(--kp-border)',
                  marginTop: 8,
                  paddingTop: 8,
                }}
              >
                <strong>{starter.name}</strong>
                <p style={mutedStyle}>{starter.description}</p>
                <Button
                  size="sm"
                  variant="secondary"
                  data-testid={`crm-starter-workflow-${starter.id}`}
                  onClick={() => {
                    chooseStarter(starter);
                  }}
                >
                  Use this template
                </Button>
              </div>
            ))}
          </section>
        </>
      )}
      {creating && (
        <section
          data-testid="crm-live-workflow-template-form"
          style={panelStyle}
        >
          <strong>Create a workflow template</strong>
          <p style={mutedStyle}>
            Start with the steps your firm follows. You can adjust them before
            publishing later.
          </p>
          <label>
            Template name
            <input
              data-testid="crm-live-workflow-name"
              value={name}
              onChange={(event) => {
                setName(event.target.value);
              }}
            />
          </label>
          {titles.map((title, index) => (
            <label key={index} style={{ display: 'block', marginTop: 8 }}>
              Step {String(index + 1)}
              <input
                data-testid={`crm-live-workflow-step-title-${String(index + 1)}`}
                value={title}
                onChange={(event) => {
                  setTitles((current) =>
                    current.map((item, position) =>
                      position === index ? event.target.value : item
                    )
                  );
                }}
              />
            </label>
          ))}
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <Button
              data-testid="crm-live-workflow-create-template"
              onClick={() => {
                void create();
              }}
            >
              Save template
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                setCreating(false);
              }}
            >
              Cancel
            </Button>
          </div>
        </section>
      )}
      {template && (
        <>
          <section data-testid="crm-live-workflow-template" style={panelStyle}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                gap: 8,
                flexWrap: 'wrap',
              }}
            >
              <div>
                <strong>{template.name}</strong>
                <p style={mutedStyle}>
                  {
                    instances.filter((item) => item.status !== 'completed')
                      .length
                  }{' '}
                  open household workflow{instances.length === 1 ? '' : 's'}
                </p>
              </div>
              <span style={{ display: 'flex', gap: 8 }}>
                <Button
                  variant="secondary"
                  data-testid="crm-live-workflow-open-propagation"
                  onClick={() => {
                    onNavigate('propagation');
                  }}
                >
                  Review updates
                </Button>
                <Button
                  variant="secondary"
                  data-testid="crm-live-workflow-edit-template"
                  onClick={() => {
                    setChangedTitle(
                      (template.steps[1] ?? template.steps[0])?.title ?? ''
                    );
                    setSchedule(template.schedule ?? schedule);
                    setOutcomes(
                      Object.fromEntries(
                        template.steps.map((step) => [step.id, step.outcomes])
                      )
                    );
                    setEditing(true);
                  }}
                >
                  Edit template
                </Button>
              </span>
            </div>
            <ol>
              {template.steps.map((step) => (
                <li key={step.id}>
                  {step.title} · {step.role} ·{' '}
                  {step.dueOffset === 0
                    ? 'start day'
                    : `day ${String(step.dueOffset + 1)}`}{' '}
                  · {step.required ? 'required' : 'optional'}
                  {step.outcomes.length
                    ? ` · ${String(step.outcomes.length)} outcome${step.outcomes.length === 1 ? '' : 's'}`
                    : ''}
                </li>
              ))}
            </ol>
            {editing && (
              <div
                data-testid="crm-live-workflow-update-form"
                style={{ ...panelStyle, background: 'var(--color-background)' }}
              >
                <strong>Update this template</strong>
                <p style={mutedStyle}>
                  Template step changes ask before they touch open household
                  work. Schedule and outcome choices guide new work from this
                  point on.
                </p>
                <label>
                  Rename “{(template.steps[1] ?? template.steps[0])?.title}”
                  <input
                    data-testid="crm-live-workflow-change-title"
                    value={changedTitle}
                    onChange={(event) => {
                      setChangedTitle(event.target.value);
                    }}
                  />
                </label>
                <label style={{ display: 'block', marginTop: 8 }}>
                  Add a step
                  <input
                    data-testid="crm-live-workflow-add-title"
                    value={addedTitle}
                    onChange={(event) => {
                      setAddedTitle(event.target.value);
                    }}
                  />
                </label>
                <section
                  data-testid="crm-live-workflow-schedule"
                  style={{
                    borderTop: '1px solid var(--kp-border)',
                    marginTop: 12,
                    paddingTop: 12,
                  }}
                >
                  <strong>Scheduled workflow</strong>
                  <p style={mutedStyle}>
                    When this time arrives, this app creates a workflow for the
                    selected households. It never sends anything outside
                    Lantern.
                  </p>
                  <label>
                    <input
                      data-testid="crm-live-workflow-schedule-enabled"
                      type="checkbox"
                      checked={schedule.enabled}
                      onChange={(event) => {
                        setSchedule((current) => ({
                          ...current,
                          enabled: event.target.checked,
                        }));
                      }}
                    />{' '}
                    Start on a schedule
                  </label>
                  <label style={{ display: 'block', marginTop: 8 }}>
                    Repeat
                    <select
                      data-testid="crm-live-workflow-schedule-frequency"
                      value={schedule.frequency}
                      onChange={(event) => {
                        setSchedule((current) => ({
                          ...current,
                          frequency: event.target
                            .value as WorkflowScheduleDraft['frequency'],
                        }));
                      }}
                    >
                      {[
                        'daily',
                        'weekly',
                        'monthly',
                        'quarterly',
                        'annual',
                      ].map((frequency) => (
                        <option key={frequency} value={frequency}>
                          {frequency}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label style={{ display: 'block', marginTop: 8 }}>
                    First run
                    <input
                      data-testid="crm-live-workflow-schedule-starts-at"
                      type="date"
                      value={schedule.startsAt.slice(0, 10)}
                      onChange={(event) => {
                        setSchedule((current) => ({
                          ...current,
                          startsAt: event.target.value,
                        }));
                      }}
                    />
                  </label>
                  <label style={{ display: 'block', marginTop: 8 }}>
                    Households
                    <select
                      data-testid="crm-live-workflow-schedule-households"
                      multiple
                      value={schedule.householdIds}
                      onChange={(event) => {
                        setSchedule((current) => ({
                          ...current,
                          householdIds: Array.from(
                            event.currentTarget.selectedOptions,
                            (option) => option.value
                          ),
                        }));
                      }}
                    >
                      {households.map((household) => (
                        <option key={household.id} value={household.id}>
                          {household.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </section>
                <section
                  data-testid="crm-live-workflow-outcome-add"
                  style={{
                    borderTop: '1px solid var(--kp-border)',
                    marginTop: 12,
                    paddingTop: 12,
                  }}
                >
                  <strong>Step outcomes and branching</strong>
                  <p style={mutedStyle}>
                    A completed step can move work to another step, restart work
                    at a step, or finish this workflow.
                  </p>
                  {template.steps.map((step) => (
                    <div key={step.id} style={{ marginTop: 8 }}>
                      <strong>{step.title}</strong>
                      {(outcomes[step.id] ?? []).map((outcome) => (
                        <div
                          key={outcome.id}
                          style={{
                            display: 'flex',
                            gap: 6,
                            marginTop: 6,
                            flexWrap: 'wrap',
                          }}
                        >
                          <input
                            data-testid={`crm-live-workflow-outcome-label-${outcome.id}`}
                            aria-label={`Outcome label for ${step.title}`}
                            value={outcome.label}
                            placeholder="Outcome, such as Approved"
                            onChange={(event) => {
                              editOutcome(step.id, outcome.id, {
                                label: event.target.value,
                              });
                            }}
                          />
                          <select
                            data-testid={`crm-live-workflow-outcome-action-${outcome.id}`}
                            value={
                              outcome.restartAtStepId
                                ? `restart:${outcome.restartAtStepId}`
                                : outcome.nextStepId
                                  ? `next:${outcome.nextStepId}`
                                  : 'complete'
                            }
                            onChange={(event) => {
                              const [kind, target] =
                                event.target.value.split(':');
                              editOutcome(
                                step.id,
                                outcome.id,
                                kind === 'next'
                                  ? {
                                      nextStepId: target,
                                      restartAtStepId: undefined,
                                    }
                                  : kind === 'restart'
                                    ? {
                                        restartAtStepId: target,
                                        nextStepId: undefined,
                                      }
                                    : {
                                        nextStepId: undefined,
                                        restartAtStepId: undefined,
                                      }
                              );
                            }}
                          >
                            <option value="complete">Complete workflow</option>
                            {template.steps
                              .filter((candidate) => candidate.id !== step.id)
                              .map((candidate) => (
                                <option
                                  key={`next-${candidate.id}`}
                                  value={`next:${candidate.id}`}
                                >
                                  Go to {candidate.title}
                                </option>
                              ))}
                            {template.steps.map((candidate) => (
                              <option
                                key={`restart-${candidate.id}`}
                                value={`restart:${candidate.id}`}
                              >
                                Restart at {candidate.title}
                              </option>
                            ))}
                          </select>
                        </div>
                      ))}
                      <Button
                        size="sm"
                        variant="secondary"
                        data-testid={`crm-live-workflow-add-outcome-${step.id}`}
                        style={{ marginTop: 6 }}
                        onClick={() => {
                          addOutcome(step.id);
                        }}
                      >
                        Add outcome
                      </Button>
                    </div>
                  ))}
                </section>
                <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                  <Button
                    data-testid="crm-live-workflow-publish"
                    onClick={() => {
                      void publish();
                    }}
                  >
                    Publish step update
                  </Button>
                  <Button
                    variant="secondary"
                    data-testid="crm-live-workflow-save-settings"
                    onClick={() => {
                      void saveSettings();
                    }}
                  >
                    Save schedule and outcomes
                  </Button>
                </div>
              </div>
            )}
          </section>
          <section style={panelStyle}>
            <strong>Start for a household</strong>
            <p style={mutedStyle}>
              This creates an open workflow for one real household. Nothing is
              shared until you choose to do so.
            </p>
            {households.length ? (
              <label>
                Household
                <select
                  data-testid="crm-live-workflow-household"
                  value={selectedHouseholdId}
                  onChange={(event) => {
                    setSelectedHouseholdId(event.target.value);
                  }}
                >
                  <option value="">Choose a household</option>
                  {households.map((household) => (
                    <option key={household.id} value={household.id}>
                      {household.label}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <label>
                Household name
                <input
                  data-testid="crm-live-workflow-new-household"
                  value={newHousehold}
                  onChange={(event) => {
                    setNewHousehold(event.target.value);
                  }}
                />
              </label>
            )}
            <Button
              data-testid="crm-live-workflow-start"
              style={{ marginLeft: 8 }}
              onClick={() => {
                void start();
              }}
            >
              Start workflow
            </Button>
          </section>
          <section data-testid="crm-live-workflow-instances" style={panelStyle}>
            <strong>Household workflows</strong>
            {instances.length === 0 ? (
              <p style={mutedStyle}>
                Start this workflow for a household to see its steps here.
              </p>
            ) : (
              instances.map((instance) => (
                <LiveInstanceCard
                  key={instance.id}
                  instance={instance}
                  onSave={save}
                />
              ))
            )}
          </section>
          <section
            data-testid="crm-live-workflow-meeting-proposal"
            style={panelStyle}
          >
            <strong>Propose a workflow from a meeting</strong>
            <p style={mutedStyle}>
              Meeting content can suggest a workflow. It always waits for a
              person to approve before it starts.
            </p>
            {data.meetings.length === 0 ? (
              <p style={mutedStyle}>No meeting activity is available yet.</p>
            ) : (
              <>
                <label>
                  Meeting
                  <select
                    data-testid="crm-live-meeting-select"
                    value={meetingId}
                    onChange={(event) => {
                      setMeetingId(event.target.value);
                    }}
                  >
                    <option value="">Choose a meeting</option>
                    {data.meetings.map((meeting) => (
                      <option key={meeting.id} value={meeting.id}>
                        {typeof meeting['summary'] === 'string'
                          ? meeting['summary']
                          : 'Untitled meeting'}
                      </option>
                    ))}
                  </select>
                </label>
                <label style={{ display: 'block', marginTop: 8 }}>
                  Household
                  <select
                    data-testid="crm-live-meeting-household"
                    value={meetingHouseholdId}
                    onChange={(event) => {
                      setMeetingHouseholdId(event.target.value);
                    }}
                  >
                    <option value="">Choose a household</option>
                    {households.map((household) => (
                      <option key={household.id} value={household.id}>
                        {household.label}
                      </option>
                    ))}
                  </select>
                </label>
                <Button
                  data-testid="crm-live-meeting-propose-workflow"
                  style={{ marginTop: 8 }}
                  disabled={!meetingId || !meetingHouseholdId}
                  onClick={() => {
                    const meeting = data.meetings.find(
                      (item) => item.id === meetingId
                    );
                    const household = households.find(
                      (item) => item.id === meetingHouseholdId
                    );
                    if (meeting && household)
                      void save(
                        createMeetingWorkflowProposal(
                          meeting,
                          template,
                          household
                        )
                      );
                  }}
                >
                  Create proposal for approval
                </Button>
              </>
            )}
          </section>
        </>
      )}
    </Screen>
  );
}

function LiveInstanceCard({
  instance,
  onSave,
}: {
  instance: LiveWorkflowInstance;
  onSave: (record: LiveCrmRecord) => Promise<unknown>;
}) {
  const [editingStep, setEditingStep] = useState<string | null>(null);
  const [localTitle, setLocalTitle] = useState('');
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [outcomeIds, setOutcomeIds] = useState<Record<string, string>>({});
  const steps = Object.values(instance.snapshot.steps).filter(
    (step) => !step.hiddenByTemplateRemoval
  );
  return (
    <section
      data-testid={`crm-live-workflow-instance-${instance.id}`}
      style={{
        borderTop: '1px solid var(--kp-border)',
        marginTop: 10,
        paddingTop: 10,
      }}
    >
      <strong>{instance.householdLabel}</strong>
      <span style={mutedStyle}>
        {' '}
        ·{' '}
        {instance.status === 'completed'
          ? 'workflow complete'
          : `${String(steps.filter((step) => step.status === 'done').length)} of ${String(steps.length)} complete`}
      </span>
      {steps.map((step) => {
        const choices = instance.outcomesByStep?.[step.stepId] ?? [];
        return (
          <div
            key={step.stepId}
            data-testid={`crm-live-workflow-instance-step-${step.stepId}`}
            style={{
              display: 'flex',
              gap: 8,
              alignItems: 'center',
              flexWrap: 'wrap',
              padding: '7px 0',
            }}
          >
            <span>{step.status === 'done' ? '✓' : '□'}</span>
            <strong>{liveStepTitle(instance, step.stepId)}</strong>
            {step.status === 'done' ? (
              <span style={mutedStyle}>
                {step.outcome ? `Completed: ${step.outcome}. ` : ''}Completed
                work stays as it is.
              </span>
            ) : (
              <>
                <>
                  {choices.length > 0 && (
                    <select
                      data-testid={`crm-live-workflow-outcome-choice-${instance.id}-${step.stepId}`}
                      value={outcomeIds[step.stepId] ?? ''}
                      onChange={(event) => {
                        setOutcomeIds((current) => ({
                          ...current,
                          [step.stepId]: event.target.value,
                        }));
                      }}
                    >
                      <option value="">Choose an outcome</option>
                      {choices.map((outcome) => (
                        <option key={outcome.id} value={outcome.id}>
                          {outcome.label}
                        </option>
                      ))}
                    </select>
                  )}
                </>
                <Button
                  size="sm"
                  variant="secondary"
                  data-testid={`crm-live-workflow-complete-${instance.id}-${step.stepId}`}
                  onClick={() => {
                    void onSave(
                      completeWorkflowStep(
                        instance,
                        step.stepId,
                        outcomeIds[step.stepId]
                      )
                    );
                  }}
                >
                  Complete step
                </Button>
              </>
            )}
            <Button
              size="sm"
              variant="secondary"
              data-testid={`crm-live-workflow-edit-local-${instance.id}-${step.stepId}`}
              onClick={() => {
                setEditingStep(step.stepId);
                setLocalTitle(liveStepTitle(instance, step.stepId));
              }}
            >
              Edit for this household
            </Button>
            {editingStep === step.stepId && (
              <span>
                <input
                  data-testid={`crm-live-workflow-local-title-${instance.id}-${step.stepId}`}
                  value={localTitle}
                  onChange={(event) => {
                    setLocalTitle(event.target.value);
                  }}
                />
                <Button
                  size="sm"
                  data-testid={`crm-live-workflow-local-save-${instance.id}-${step.stepId}`}
                  onClick={() => {
                    void onSave(
                      renameWorkflowStepLocally(
                        instance,
                        step.stepId,
                        localTitle
                      )
                    );
                    setEditingStep(null);
                  }}
                >
                  Save
                </Button>
              </span>
            )}
            <div
              data-testid="crm-live-workflow-step-comment"
              style={{ width: '100%' }}
            >
              <textarea
                data-testid={`crm-live-workflow-step-note-${instance.id}-${step.stepId}`}
                value={notes[step.stepId] ?? ''}
                placeholder="Add an internal step comment"
                onChange={(event) => {
                  setNotes((current) => ({
                    ...current,
                    [step.stepId]: event.target.value,
                  }));
                }}
              />
              <Button
                size="sm"
                variant="secondary"
                data-testid={`crm-live-workflow-save-note-${instance.id}-${step.stepId}`}
                disabled={!notes[step.stepId]?.trim()}
                onClick={() => {
                  void onSave(
                    addWorkflowStepNote(
                      instance,
                      step.stepId,
                      notes[step.stepId] ?? ''
                    )
                  );
                  setNotes((current) => ({ ...current, [step.stepId]: '' }));
                }}
              >
                Save comment
              </Button>
              {step.stepNotes && (
                <p
                  data-testid={`crm-live-workflow-step-notes-${instance.id}-${step.stepId}`}
                  style={mutedStyle}
                >
                  {step.stepNotes}
                </p>
              )}
            </div>
          </div>
        );
      })}
    </section>
  );
}

function plainField(
  decision: LiveWorkflowOffer['engineOffer']['decisions'][number],
  instance: LiveWorkflowInstance
) {
  const before = stepValue(instance, decision.stepId, decision.field);
  const value = displayValue(decision.value);
  if (decision.changeKind === 'add')
    return decision.field === 'title'
      ? `Add “${value}”`
      : `${decision.field === 'defaultAssigneeRole' ? 'Send it to' : decision.field === 'dueOffset' ? 'Schedule it for' : 'Set'} ${value}`;
  if (decision.changeKind === 'remove')
    return 'Remove this untouched future step';
  if (decision.field === 'title')
    return `Rename “${displayValue(before)}” to “${value}”`;
  if (decision.field === 'dueOffset')
    return `Move timing from ${displayValue(before) || 'the current day'} to ${value}`;
  if (decision.field === 'defaultAssigneeRole')
    return `Send new work from ${displayValue(before) || 'the current role'} to ${value}`;
  return `Change ${decision.field} from ${displayValue(before) || 'the current setting'} to ${value}`;
}

function LivePropagationReview({
  data,
  onSave,
}: {
  data: LiveWorkflowData;
  onSave: (record: LiveCrmRecord) => Promise<unknown>;
}) {
  const [message, setMessage] = useState<string | null>(null);
  const offers = data.offers.filter(
    (offer) => offer.engineOffer.state === 'pending'
  );
  const instanceFor = (offer: LiveWorkflowOffer) =>
    data.instances.find(
      (instance) => instance.id === offer.engineOffer.instanceId
    );
  const templateFor = (offer: LiveWorkflowOffer) =>
    data.templates.find((template) => template.id === offer.templateId);
  const change = async (
    offer: LiveWorkflowOffer,
    decisionId: string,
    decision: 'accepted' | 'rejected'
  ) => {
    await onSave(decideOffer(offer, decisionId, decision));
  };
  const apply = async (offer: LiveWorkflowOffer) => {
    const template = templateFor(offer);
    const instance = instanceFor(offer);
    if (!template || !instance) return;
    try {
      const result = applyWorkflowOffer(template, instance, offer);
      await onSave(result.instance);
      await onSave(result.offer);
      setMessage(
        `${offer.householdLabel} is updated. Completed work and notes stayed as they were.`
      );
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : String(reason));
    }
  };
  const undo = async (instance: LiveWorkflowInstance) => {
    const result = undoWorkflowApply(instance);
    await onSave(result.instance);
    setMessage(
      result.protectedCells.length
        ? `Restored ${String(result.undoneCells.length)} untouched change${result.undoneCells.length === 1 ? '' : 's'}. Kept ${String(result.protectedCells.length)} later household change${result.protectedCells.length === 1 ? '' : 's'}: ${result.protectedCells.join(', ')}.`
        : `Restored ${String(result.undoneCells.length)} untouched change${result.undoneCells.length === 1 ? '' : 's'}. No later household changes needed to stay.`
    );
  };
  return (
    <Screen
      title="Workflow update review"
      description="Choose how a template update should affect open household work"
      Icon={GitPullRequest}
      action={undefined}
    >
      {offers.length === 0 ? (
        <section style={panelStyle}>
          <strong>No workflow updates waiting for review</strong>
          <p style={mutedStyle}>
            When you update a workflow template, each household’s open work will
            appear here for a simple choice.
          </p>
        </section>
      ) : (
        <>
          <section style={panelStyle}>
            <strong>Workflow updates ready to review</strong>
            <p style={mutedStyle}>
              Choose what should change for each household. Work already done
              stays exactly as it is.
            </p>
          </section>
          {offers.map((offer) => {
            const instance = instanceFor(offer);
            const grouped = new Map<
              string,
              LiveWorkflowOffer['engineOffer']['decisions']
            >();
            for (const decision of offer.engineOffer.decisions)
              grouped.set(decision.stepId, [
                ...(grouped.get(decision.stepId) ?? []),
                decision,
              ]);
            const changeCount = offer.engineOffer.decisions.length;
            const ready =
              !offer.engineOffer.requiresConcurrentHeadReview &&
              !offer.engineOffer.decisions.some(
                (decision) => decision.decision === 'review_required'
              );
            return (
              <section
                key={offer.id}
                data-testid={`crm-live-propagation-offer-${offer.id}`}
                style={panelStyle}
              >
                <strong>{offer.householdLabel}: Template updated</strong>
                <p style={mutedStyle}>
                  {changeCount} change{changeCount === 1 ? '' : 's'} to review.
                  Work already done stays as it is.
                </p>
                {offer.engineOffer.requiresConcurrentHeadReview && (
                  <p
                    role="alert"
                    style={{ ...panelStyle, borderColor: 'var(--kp-direct)' }}
                  >
                    This workflow was changed in two places. Compare each choice
                    before applying.
                  </p>
                )}
                {[...grouped.entries()].map(([stepId, decisions]) => (
                  <div
                    key={stepId}
                    style={{
                      borderTop: '1px solid var(--kp-border)',
                      paddingTop: 9,
                      marginTop: 9,
                    }}
                  >
                    <strong>
                      {instance
                        ? liveStepTitle(instance, stepId)
                        : 'New workflow step'}
                    </strong>
                    {instance?.snapshot.steps[stepId]?.status === 'done' && (
                      <p style={mutedStyle}>
                        This step is complete. Its completed work and notes will
                        not change.
                      </p>
                    )}
                    {decisions.map((decision) => (
                      <div
                        key={decision.id}
                        style={{
                          display: 'flex',
                          gap: 8,
                          alignItems: 'center',
                          padding: '6px 0',
                        }}
                      >
                        <span style={{ flex: 1 }}>
                          {plainField(
                            decision,
                            instance ??
                              ({
                                snapshot: { steps: {} },
                              } as LiveWorkflowInstance)
                          )}
                        </span>
                        <Button
                          size="sm"
                          variant={
                            decision.decision === 'accepted'
                              ? 'primary'
                              : 'secondary'
                          }
                          data-testid={`crm-live-propagation-accept-${decision.id}`}
                          onClick={() => {
                            void change(offer, decision.id, 'accepted');
                          }}
                        >
                          Apply
                        </Button>
                        <Button
                          size="sm"
                          variant={
                            decision.decision === 'rejected'
                              ? 'primary'
                              : 'secondary'
                          }
                          data-testid={`crm-live-propagation-reject-${decision.id}`}
                          onClick={() => {
                            void change(offer, decision.id, 'rejected');
                          }}
                        >
                          Keep current
                        </Button>
                      </div>
                    ))}
                  </div>
                ))}
                <details style={{ marginTop: 10 }}>
                  <summary>Details for support</summary>
                  <p style={mutedStyle}>
                    Update: {offer.revisionLabel}. Record: {offer.id}. Workflow:{' '}
                    {offer.engineOffer.instanceId}.
                  </p>
                </details>
                <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                  <Button
                    data-testid={`crm-live-propagation-apply-${offer.id}`}
                    disabled={!ready}
                    onClick={() => {
                      void apply(offer);
                    }}
                  >
                    Apply these changes
                  </Button>
                  {instance?.lastApplyEventId && (
                    <Button
                      variant="secondary"
                      data-testid={`crm-live-propagation-undo-${instance.id}`}
                      onClick={() => {
                        void undo(instance);
                      }}
                    >
                      Undo last update
                    </Button>
                  )}
                </div>
              </section>
            );
          })}
        </>
      )}
      {data.instances
        .filter((instance) => instance.lastApplyEventId)
        .map((instance) => (
          <section key={`undo-${instance.id}`} style={panelStyle}>
            <strong>{instance.householdLabel}</strong>
            <span style={mutedStyle}>
              {' '}
              · Last update can be undone safely. Later household edits will
              stay in place.
            </span>
            <Button
              data-testid={`crm-live-propagation-undo-${instance.id}`}
              variant="secondary"
              style={{ marginLeft: 8 }}
              onClick={() => {
                void undo(instance);
              }}
            >
              Undo last update
            </Button>
          </section>
        ))}
      {message && (
        <p data-testid="crm-live-propagation-result" role="status">
          {message}
        </p>
      )}
    </Screen>
  );
}

export function Reports({ freshness }: { freshness: CrmFreshnessState }) {
  const [running, setRunning] = useState(false);
  const [report, setReport] = useState('No contact in 6 months');
  return (
    <Screen
      title="Reports"
      description="Answers from current records"
      Icon={BarChart3}
      action={
        <Button
          data-testid="crm-report-run"
          iconLeft={RefreshCw}
          onClick={() => {
            setRunning(true);
          }}
        >
          Run report
        </Button>
      }
    >
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <AskBar />
        {[
          'No contact in 6 months',
          'Attention vs fee',
          'Birthdays',
          'Age 65',
          'RMD due',
          'Review due',
        ].map((name) => (
          <button
            key={name}
            data-testid={`crm-report-${name.replaceAll(' ', '-').toLowerCase()}`}
            aria-pressed={report === name}
            onClick={() => {
              setReport(name);
            }}
          >
            {name}
          </button>
        ))}
      </div>
      <FreshnessBanner freshness={freshness} />
      <section style={panelStyle}>
        <strong>
          {running ? 'Computed just now' : 'Choose a report'} from 1,284 sources
        </strong>
        <p style={mutedStyle}>
          N means decrypted records and source-backed facts considered after
          filters.{' '}
          {report === 'Attention vs fee'
            ? 'Fee data is missing; this report does not estimate it.'
            : ''}
        </p>
        {running && (
          <>
            <p>
              Henderson household · Last meaningful contact Jan 8 · Platinum
            </p>
            <p>Ortiz household · Last meaningful contact Dec 17 · Gold</p>
            <Button variant="secondary">Save this view</Button>{' '}
            <Button variant="secondary">Export as Word</Button>
          </>
        )}
      </section>
    </Screen>
  );
}

export function FirmSetup({
  onNavigate,
  freshness,
}: {
  onNavigate: (route: CrmHomeRoute) => void;
  freshness: CrmFreshnessState;
}) {
  return (
    <Screen
      title="Firm"
      description="The few rules that shape real work"
      Icon={Users}
      action={
        <Button data-testid="crm-firm-open-admin" iconLeft={ShieldCheck}>
          Open firm administration
        </Button>
      }
    >
      <FreshnessBanner freshness={freshness} />
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
          gap: 10,
        }}
      >
        {[
          {
            route: 'firm-setup' as const,
            label: 'Firm setup',
            detail: 'Members, roles, service tiers, retention, teams',
          },
          {
            route: 'fields-tags' as const,
            label: 'Fields and tags',
            detail: 'Shared structure for records',
          },
          {
            route: 'intake-links' as const,
            label: 'Intake links',
            detail: 'Create, preview, review',
          },
          {
            route: 'migration' as const,
            label: 'Migration',
            detail: 'Mirror, parallel run, cutover',
          },
        ].map((item) => (
          <button
            key={item.route}
            data-testid={`crm-firm-route-${item.route}`}
            onClick={() => {
              onNavigate(item.route);
            }}
            style={{ ...panelStyle, textAlign: 'left', cursor: 'pointer' }}
          >
            <strong>{item.label}</strong>
            <p style={mutedStyle}>{item.detail}</p>
          </button>
        ))}
      </div>
      <section style={panelStyle}>
        <strong>Members · Roles · Service tiers · Retention · Teams</strong>
        <p>Maya Patel · Owner · Active · display from firm administration</p>
        <p style={mutedStyle}>
          This is a display-only shell over firm administration. Ethical walls,
          invitations, access, and deactivation are managed there.
        </p>
      </section>
    </Screen>
  );
}

function FieldsTags() {
  return (
    <Screen
      title="Fields and tags"
      description="Shared structure without setup before value"
      Icon={Tags}
      action={
        <Button data-testid="crm-field-new" iconLeft={Plus}>
          New field
        </Button>
      }
    >
      <section style={panelStyle}>
        <strong>Custom fields</strong>
        <p>
          Service region · Choice · Household · Optional{' '}
          <Button size="sm" variant="secondary">
            Edit
          </Button>
        </p>
        <p>
          Referral source · Choice · Household · Optional{' '}
          <Button size="sm" variant="secondary">
            Edit
          </Button>
        </p>
      </section>
      <section style={panelStyle}>
        <strong>Tags</strong>
        <p>
          <span>Tax planning</span> · <span>New client</span> ·{' '}
          <span>Money movement</span>
        </p>
        <Button variant="secondary">Manage tags</Button>
        <p style={mutedStyle}>
          Changing a field type after values exist is blocked. Make a
          replacement instead.
        </p>
      </section>
      <section style={panelStyle}>
        <strong>Firm documents</strong>
        <p style={mutedStyle}>
          Title, type, tags, last update. Content stays in the existing document
          editor.
        </p>
        <Button variant="secondary">Open in document editor</Button>
      </section>
    </Screen>
  );
}

function IntakeLinks() {
  return (
    <Screen
      title="Intake links"
      description="Scoped forms that create reviewable submissions"
      Icon={ClipboardList}
      action={
        <Button data-testid="crm-intake-new" iconLeft={Plus}>
          New intake link
        </Button>
      }
    >
      <section style={panelStyle}>
        <strong>New client information</strong>
        <p style={mutedStyle}>
          Choose fields and confirmation copy, preview on phone or desktop, then
          copy/share the link. A submission never writes directly into a
          household.
        </p>
        <Button variant="secondary">Preview form</Button>{' '}
        <Button variant="secondary">Copy link</Button>
      </section>
      <section style={panelStyle}>
        <strong>Submission review</strong>
        <p>One response needs a deliberate match/create decision.</p>
        <Button>Match this response</Button>
      </section>
    </Screen>
  );
}

function Migration({
  route,
  freshness,
  migration,
  onNavigate,
  actions,
}: {
  route: CrmHomeRoute;
  freshness: CrmFreshnessState;
  migration: CrmHomeAdapter['migration'];
  onNavigate: (route: CrmHomeRoute) => void;
  actions: CrmHomeAdapter['actions'];
}) {
  const [parallel, setParallel] = useState(false);
  const [baseUrl, setBaseUrl] = useState('http://127.0.0.1:8788/v1');
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async () => {
    setRunning(true);
    setError(null);
    try {
      await actions.runMigrationImport?.(baseUrl);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setRunning(false);
    }
  };
  const exportKind =
    route === 'archive-export'
      ? 'archive'
      : route === 'rollback-export'
        ? 'rollback'
        : null;
  if (exportKind)
    return (
      <ExportReadiness
        job={
          migration.exports.find((job) => job.kind === exportKind) ?? {
            kind: exportKind,
            status: 'failed',
            failureReason: 'No export job was supplied by the CRM data engine.',
          }
        }
        onCreate={() => actions.createExport?.(exportKind)}
        onRetry={() => actions.retryExport?.(exportKind)}
      />
    );
  if (route === 'workflow-recreation')
    return (
      <WorkflowFallbackChecklist
        records={migration.workflowChecklists}
        onRecord={(record) => actions.recordWorkflowChecklist?.(record)}
      />
    );
  if (route === 'attachment-accounting')
    return (
      <AttachmentFallbackChecklist
        records={migration.attachmentAccounting}
        onRecord={(record) => actions.recordAttachmentAccounting?.(record)}
      />
    );
  if (route === 'fidelity')
    return (
      <FidelityReport
        onNavigate={onNavigate}
        {...(migration.noteGaps ? { noteGaps: migration.noteGaps } : {})}
        {...(migration.report ? { report: migration.report } : {})}
      />
    );
  return (
    <Screen
      title="Wealthbox migration"
      description="Bring your firm’s records over safely"
      Icon={Activity}
      action={
        <Button
          data-testid="crm-migration-fidelity"
          disabled={!migration.report}
          onClick={() => {
            onNavigate('fidelity');
          }}
        >
          Review import report
        </Button>
      }
    >
      <FreshnessBanner freshness={freshness} />
      <section style={panelStyle}>
        <strong>
          {migration.report
            ? 'Import finished'
            : 'Connect the test source and import'}
        </strong>
        <p style={mutedStyle}>
          {migration.report
            ? migration.report.message
            : 'This test source only contains made-up Northcrest firm data.'}
        </p>
        <label style={{ display: 'block', marginBottom: 10 }}>
          Test source address{' '}
          <input
            data-testid="crm-migration-base-url"
            value={baseUrl}
            onChange={(event) => {
              setBaseUrl(event.target.value);
            }}
            style={{ display: 'block', width: 'min(620px, 100%)' }}
          />
        </label>
        <Button
          data-testid="crm-migration-run-import"
          disabled={running}
          onClick={() => {
            void run();
          }}
        >
          {running
            ? 'Importing…'
            : migration.report
              ? 'Run import again'
              : 'Run import'}
        </Button>
        {error && (
          <p data-testid="crm-migration-error" role="alert">
            {error}
          </p>
        )}
      </section>
      <section style={panelStyle}>
        <strong>Use both systems while you check the import</strong>
        <p style={mutedStyle}>
          Lantern brings over only what it can read safely. When it cannot tell
          where an active workflow is, it asks your firm to decide instead of
          guessing.
        </p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Button
            variant="secondary"
            data-testid="crm-migration-archive"
            disabled={!migration.report}
            iconLeft={FileArchive}
            onClick={() => {
              onNavigate('archive-export');
            }}
          >
            Save a backup
          </Button>
          <Button
            variant="secondary"
            data-testid="crm-migration-rollback"
            disabled={!migration.report}
            iconLeft={Download}
            onClick={() => {
              onNavigate('rollback-export');
            }}
          >
            Prepare a return file
          </Button>
          <Button
            data-testid="crm-migration-start-parallel"
            disabled={parallel || !migration.report}
            onClick={() => {
              setParallel(true);
            }}
          >
            {parallel ? 'Both systems are in use' : 'Start using both systems'}
          </Button>
        </div>
      </section>
      <section style={panelStyle}>
        <strong>What your firm needs to decide</strong>
        <p style={mutedStyle}>
          If something cannot be brought over, the report gives you a clear next
          step. Nothing is hidden behind technical error names.
        </p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Button
            variant="secondary"
            data-testid="crm-migration-workflow-fallback"
            disabled={!migration.report}
            onClick={() => {
              onNavigate('workflow-recreation');
            }}
          >
            Rebuild active workflows
          </Button>
          <Button
            variant="secondary"
            data-testid="crm-migration-attachment-fallback"
            disabled={!migration.report}
            onClick={() => {
              onNavigate('attachment-accounting');
            }}
          >
            Account for attachments
          </Button>
        </div>
      </section>
    </Screen>
  );
}

function FidelityReport({
  onNavigate,
  report,
  noteGaps = [],
}: {
  onNavigate: (route: CrmHomeRoute) => void;
  report?: MigrationFidelityReport;
  noteGaps?: readonly MigrationNoteGap[];
}) {
  const [showNotes, setShowNotes] = useState(false);
  if (!report)
    return (
      <Screen
        title="Import report"
        description="No import has run yet"
        Icon={Flag}
      >
        <p>Run the import first.</p>
      </Screen>
    );
  const skippedNotes =
    report.matrix.find((row) => row.sourceType === 'note')?.skipped ?? 0;
  const workflowNeedsAttention = report.workflows.pending;
  const attachmentNeedsAttention = report.attachments.unaccounted;
  const decisionCount =
    skippedNotes + workflowNeedsAttention + attachmentNeedsAttention;
  const labelFor = (sourceType: string) =>
    ({
      contact: 'Clients',
      note: 'Notes',
      task: 'Tasks',
      event: 'Events',
      opportunity: 'Opportunities',
      project: 'Projects',
      workflow_template: 'Workflow templates',
      workflow: 'Active workflows',
      custom_field: 'Custom fields',
      attachment: 'Attachments',
    })[sourceType] ?? sourceType.replaceAll('_', ' ');
  return (
    <Screen
      title="Import report"
      description={new Date(report.generatedAt).toLocaleString()}
      Icon={Flag}
    >
      <section
        data-testid="crm-migration-decision-dashboard"
        style={panelStyle}
      >
        <strong>
          {decisionCount > 0
            ? `Not ready to switch yet: ${String(decisionCount)} item${decisionCount === 1 ? '' : 's'} need your firm’s decision.`
            : 'Your import has no open migration decisions.'}
        </strong>
        <p style={mutedStyle}>
          Nothing is hidden. Resolve each item below before you switch systems.
        </p>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            gap: 10,
          }}
        >
          <section
            style={{ ...panelStyle, background: 'var(--color-background)' }}
          >
            <strong>
              {String(skippedNotes)} note{skippedNotes === 1 ? '' : 's'} we
              could not bring over
            </strong>
            <p style={mutedStyle}>
              These notes were not safely linked to a client. Check them in
              Wealthbox, then add any important note to the right household.
            </p>
            <Button
              variant="secondary"
              data-testid="crm-migration-open-note-gaps"
              onClick={() => {
                setShowNotes((open) => !open);
              }}
            >
              {showNotes ? 'Close note list' : 'Review these notes'}
            </Button>
          </section>
          <section
            style={{ ...panelStyle, background: 'var(--color-background)' }}
          >
            <strong>
              {String(workflowNeedsAttention)} active workflow
              {workflowNeedsAttention === 1 ? '' : 's'} to rebuild
            </strong>
            <p style={mutedStyle}>
              Choose the current step for each household, then rebuild its
              remaining work in Lantern.
            </p>
            <Button
              variant="secondary"
              data-testid="crm-migration-workflow-fallback"
              onClick={() => {
                onNavigate('workflow-recreation');
              }}
            >
              Rebuild these workflows
            </Button>
          </section>
          <section
            style={{ ...panelStyle, background: 'var(--color-background)' }}
          >
            <strong>
              {String(attachmentNeedsAttention)} attachment
              {attachmentNeedsAttention === 1 ? '' : 's'} to account for
            </strong>
            <p style={mutedStyle}>
              Mark each attachment as exported, or explain what is missing and
              who owns the follow-up.
            </p>
            <Button
              variant="secondary"
              data-testid="crm-migration-attachment-fallback"
              onClick={() => {
                onNavigate('attachment-accounting');
              }}
            >
              Account for attachments
            </Button>
          </section>
        </div>
        {showNotes && (
          <section
            data-testid="crm-migration-note-gap-list"
            style={{
              borderTop: '1px solid var(--kp-border)',
              marginTop: 12,
              paddingTop: 12,
            }}
          >
            <strong>Notes to check</strong>
            {noteGaps.length === 0 ? (
              <p style={mutedStyle}>
                {skippedNotes === 0
                  ? 'No notes need review.'
                  : 'This import recorded the count but not note titles. Open the saved migration archive to find them.'}
              </p>
            ) : (
              noteGaps.map((note) => (
                <p key={note.id}>
                  <strong>{note.label}</strong>
                  <span style={mutedStyle}> · {note.reason}</span>
                </p>
              ))
            )}
          </section>
        )}
      </section>
      <section style={panelStyle}>
        <strong>What came over</strong>
        <p style={mutedStyle}>{report.message}</p>
        <div data-testid="crm-fidelity-matrix">
          {report.matrix.map((row) => (
            <section
              key={row.sourceType}
              data-testid={`crm-fidelity-row-${row.sourceType}`}
              style={{
                borderTop: '1px solid var(--kp-border)',
                padding: '8px 0',
              }}
            >
              <strong>{labelFor(row.sourceType)}</strong>
              <span>
                {' '}
                · {row.fetched} found · {row.imported} imported · {row.skipped}{' '}
                not imported
              </span>
              {row.plainReason ? (
                <p role="alert" style={mutedStyle}>
                  {row.plainReason}
                </p>
              ) : null}
            </section>
          ))}
        </div>
      </section>
    </Screen>
  );
}

function WorkflowFallbackChecklist({
  records,
  onRecord,
}: {
  records: readonly MigrationWorkflowChecklist[];
  onRecord: (record: MigrationWorkflowChecklist) => void | Promise<void>;
}) {
  const [drafts, setDrafts] = useState(records);
  const [saved, setSaved] = useState<ReadonlySet<string>>(() => new Set());
  const update = (id: string, change: Partial<MigrationWorkflowChecklist>) => {
    setDrafts((current) =>
      current.map((record) =>
        record.id === id ? { ...record, ...change } : record
      )
    );
  };
  const complete = (record: MigrationWorkflowChecklist) =>
    record.evidenceReviewed &&
    record.selectedCurrentStep &&
    (record.decision === 'recreate' ||
      (record.decision === 'gap' && record.gapReason));
  const recordChecklist = async (record: MigrationWorkflowChecklist) => {
    await onRecord(record);
    setSaved((current) => new Set(current).add(record.id));
  };
  return (
    <Screen
      title="Rebuild active workflows"
      description="Finish this before switching systems"
      Icon={Workflow}
    >
      <p style={mutedStyle}>
        We could not safely read where these workflows are today. Review the
        evidence below, choose the current step, then rebuild the remaining work
        or explain why it cannot be rebuilt.
      </p>
      {drafts.map((record) => (
        <section
          key={record.id}
          data-testid={`crm-workflow-checklist-${record.id}`}
          style={panelStyle}
        >
          <strong>
            {record.clientLabel} · {record.sourceTemplateLabel}
          </strong>
          <p style={mutedStyle}>
            What we found:{' '}
            {record.activityEvidence.join(' · ') ||
              'No readable history is available'}
          </p>
          <label>
            <input
              data-testid={`crm-workflow-evidence-${record.id}`}
              type="checkbox"
              checked={Boolean(record.evidenceReviewed)}
              onChange={(event) => {
                update(record.id, { evidenceReviewed: event.target.checked });
              }}
            />{' '}
            I reviewed what was available
          </label>
          <label style={{ display: 'block', marginTop: 8 }}>
            Current step{' '}
            <select
              data-testid={`crm-workflow-step-${record.id}`}
              value={record.selectedCurrentStep ?? ''}
              onChange={(event) => {
                update(record.id, { selectedCurrentStep: event.target.value });
              }}
            >
              <option value="">Choose the current step</option>
              {record.availableSteps.map((step) => (
                <option key={step}>{step}</option>
              ))}
            </select>
          </label>
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <Button
              size="sm"
              variant={record.decision === 'recreate' ? 'primary' : 'secondary'}
              onClick={() => {
                update(record.id, { decision: 'recreate' });
              }}
            >
              Rebuild this workflow
            </Button>
            <Button
              size="sm"
              variant={record.decision === 'gap' ? 'primary' : 'secondary'}
              onClick={() => {
                update(record.id, { decision: 'gap' });
              }}
            >
              Explain why it cannot be rebuilt
            </Button>
          </div>
          {record.decision === 'recreate' ? (
            <label style={{ display: 'block', marginTop: 8 }}>
              New workflow name{' '}
              <input
                data-testid={`crm-workflow-instance-${record.id}`}
                value={record.resultingInstanceLabel ?? ''}
                onChange={(event) => {
                  update(record.id, {
                    resultingInstanceLabel: event.target.value,
                  });
                }}
              />
            </label>
          ) : record.decision === 'gap' ? (
            <label style={{ display: 'block', marginTop: 8 }}>
              Why it cannot be rebuilt{' '}
              <input
                data-testid={`crm-workflow-gap-${record.id}`}
                value={record.gapReason ?? ''}
                onChange={(event) => {
                  update(record.id, { gapReason: event.target.value });
                }}
              />
            </label>
          ) : null}
          <Button
            data-testid={`crm-workflow-record-${record.id}`}
            style={{ marginTop: 10 }}
            disabled={!complete(record)}
            onClick={() => {
              void recordChecklist(record);
            }}
          >
            Save this decision
          </Button>
          {saved.has(record.id) && (
            <p data-testid={`crm-workflow-recorded-${record.id}`} role="status">
              Decision saved
            </p>
          )}
        </section>
      ))}
    </Screen>
  );
}

function AttachmentFallbackChecklist({
  records,
  onRecord,
}: {
  records: readonly AttachmentAccountingRecord[];
  onRecord: (record: AttachmentAccountingRecord) => void | Promise<void>;
}) {
  const [drafts, setDrafts] = useState(records);
  const [saved, setSaved] = useState<ReadonlySet<string>>(() => new Set());
  const update = (id: string, change: Partial<AttachmentAccountingRecord>) => {
    setDrafts((current) =>
      current.map((record) =>
        record.id === id ? { ...record, ...change } : record
      )
    );
  };
  const complete = (record: AttachmentAccountingRecord) =>
    (record.status === 'exported' &&
      record.exportSource &&
      record.exportedBy) ||
    (record.status === 'gap' && record.gapReason && record.gapOwner);
  const recordAttachment = async (record: AttachmentAccountingRecord) => {
    await onRecord(record);
    setSaved((current) => new Set(current).add(record.id));
  };
  return (
    <Screen
      title="Attachment accounting"
      description="Required through cutover"
      Icon={FileArchive}
    >
      <p style={mutedStyle}>
        Every affected client needs exactly one complete record. An absence is
        never silently treated as no attachment.
      </p>
      {drafts.map((record) => (
        <section
          key={record.id}
          data-testid={`crm-attachment-record-${record.id}`}
          style={panelStyle}
        >
          <strong>{record.clientLabel}</strong>
          <label style={{ display: 'block', marginTop: 8 }}>
            Status{' '}
            <select
              data-testid={`crm-attachment-status-${record.id}`}
              value={record.status}
              onChange={(event) => {
                update(record.id, {
                  status: event.target
                    .value as AttachmentAccountingRecord['status'],
                });
              }}
            >
              <option value="pending">Choose a status</option>
              <option value="exported">Exported</option>
              <option value="gap">Attachment gap</option>
            </select>
          </label>
          {record.status === 'exported' ? (
            <>
              <label style={{ display: 'block', marginTop: 8 }}>
                Export source{' '}
                <input
                  data-testid={`crm-attachment-source-${record.id}`}
                  value={record.exportSource ?? ''}
                  onChange={(event) => {
                    update(record.id, { exportSource: event.target.value });
                  }}
                />
              </label>
              <label style={{ display: 'block', marginTop: 8 }}>
                Operator{' '}
                <input
                  data-testid={`crm-attachment-operator-${record.id}`}
                  value={record.exportedBy ?? ''}
                  onChange={(event) => {
                    update(record.id, { exportedBy: event.target.value });
                  }}
                />
              </label>
            </>
          ) : record.status === 'gap' ? (
            <>
              <label style={{ display: 'block', marginTop: 8 }}>
                Gap reason{' '}
                <input
                  data-testid={`crm-attachment-reason-${record.id}`}
                  value={record.gapReason ?? ''}
                  onChange={(event) => {
                    update(record.id, { gapReason: event.target.value });
                  }}
                />
              </label>
              <label style={{ display: 'block', marginTop: 8 }}>
                Gap owner{' '}
                <input
                  data-testid={`crm-attachment-owner-${record.id}`}
                  value={record.gapOwner ?? ''}
                  onChange={(event) => {
                    update(record.id, { gapOwner: event.target.value });
                  }}
                />
              </label>
            </>
          ) : null}
          <Button
            data-testid={`crm-attachment-record-save-${record.id}`}
            style={{ marginTop: 10 }}
            disabled={!complete(record)}
            onClick={() => {
              void recordAttachment(record);
            }}
          >
            Record this client’s attachment status
          </Button>
          {saved.has(record.id) && (
            <p
              data-testid={`crm-attachment-recorded-${record.id}`}
              role="status"
            >
              Attachment status recorded
            </p>
          )}
        </section>
      ))}
    </Screen>
  );
}

function ExportReadiness({
  job,
  onCreate,
  onRetry,
}: {
  job: ExportJobStatus;
  onCreate: () => void;
  onRetry: () => void;
}) {
  const kind = job.kind;
  return (
    <Screen
      title={`${kind === 'archive' ? 'Archive' : 'Rollback'} export`}
      description="Prepare an export without changing a connector account"
      Icon={kind === 'archive' ? FileArchive : Download}
    >
      <section style={panelStyle}>
        <strong>
          {job.status === 'ready'
            ? 'Ready to prepare'
            : job.status === 'preparing'
              ? 'Preparing export'
              : job.status === 'exported'
                ? 'Exported'
                : 'Failed — retry available'}
        </strong>
        <ul>
          {kind === 'archive' ? (
            <>
              <li>Manifest present</li>
              <li>Raw-capture checksums verified</li>
              <li>Fidelity counts matched</li>
              <li>Storage destination selected</li>
            </>
          ) : (
            <>
              <li>Full check complete</li>
              <li>Current report saved</li>
              <li>Eligible Lantern changes counted</li>
              <li>Destination format checked</li>
              <li>Known unsupported items listed</li>
            </>
          )}
        </ul>
        {job.status === 'exported' ? (
          <>
            <p data-testid="crm-exported-status">
              Exported {job.exportedAt ?? 'at the recorded export time'} ·{' '}
              {kind === 'archive'
                ? `Manifest ID: ${job.manifestId ?? 'missing from engine data'}`
                : `Reconciliation report: ${job.reconciliationReportId ?? 'missing from engine data'}`}
            </p>
            {job.filePath ? (
              <p data-testid="crm-export-file" style={mutedStyle}>
                Saved file: {job.filePath}
                {typeof job.byteLength === 'number'
                  ? ` · ${String(job.byteLength)} bytes`
                  : ''}
                {job.sha256 ? ` · checksum ${job.sha256}` : ''}
              </p>
            ) : (
              <p role="alert">
                The export status is saved, but no file location was recorded.
              </p>
            )}
          </>
        ) : job.status === 'failed' ? (
          <>
            <p role="alert">
              {job.failureReason ??
                'The export failed. Nothing changed in the connector account.'}
            </p>
            <Button data-testid="crm-export-retry" onClick={onRetry}>
              Retry {kind} export
            </Button>
          </>
        ) : job.status === 'preparing' ? (
          <p data-testid="crm-export-preparing" role="status">
            Preparing the export. This page will update when the CRM data engine
            records its result.
          </p>
        ) : (
          <Button data-testid="crm-export-create" onClick={onCreate}>
            Create {kind} export
          </Button>
        )}
      </section>
    </Screen>
  );
}

function Screen({
  title,
  description,
  Icon,
  action,
  children,
}: {
  title: string;
  description: string;
  Icon: typeof LayoutDashboard;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div
      data-testid={`crm-screen-${title.toLowerCase().replaceAll(' ', '-')}`}
      style={{
        padding: 'var(--kp-space-xl)',
        overflow: 'auto',
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--kp-space-md)',
      }}
    >
      <SurfaceHeader
        Icon={Icon}
        title={title}
        description={description}
        actions={action}
      />
      {children}
    </div>
  );
}

function ConnectedCrmHome({
  adapter,
  initialRoute = 'today',
  preview = false,
  workflowData,
  workflowHouseholds,
  saveLiveRecord,
}: Required<Pick<CrmHomeProps, 'adapter'>> &
  Omit<CrmHomeProps, 'adapter'> & {
    workflowData?: LiveWorkflowData;
    workflowHouseholds?: readonly HouseholdChoice[];
    saveLiveRecord?: (record: LiveCrmRecord) => Promise<unknown>;
  }) {
  // The screen receives engine-derived data only; preview data is opt-in above.
  const activeAdapter = adapter;
  const [route, setRoute] = useState<CrmHomeRoute>(initialRoute);
  const [undoReport, setUndoReport] = useState<string | null>(null);
  const freshness = activeAdapter.freshness;
  const offers = activeAdapter.offers;
  const approvals = activeAdapter.approvals ?? [];
  const activity = activeAdapter.activity ?? [];
  const savedTaskViews = activeAdapter.savedTaskViews ?? [];
  const updateTask = async (task: CrmTask) => {
    await activeAdapter.actions.updateTask?.(task);
  };
  const jump = (next: CrmHomeRoute) => {
    setRoute(next);
  };
  const reportUndo = useCallback(() => {
    const result = activeAdapter.actions.undoPropagation?.() ?? {
      restored: 0,
      protectedCells: [],
    };
    setUndoReport(
      result.protectedCells.length
        ? `${String(result.restored)} untouched derived cells restored. Protected cells kept: ${result.protectedCells.join(', ')}.`
        : `${String(result.restored)} untouched derived cells restored. No protected cells needed to stay.`
    );
  }, [activeAdapter]);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement | null)?.tagName === 'INPUT') return;
      if (event.key === 'g') {
        (window as Window & { __crmGo?: boolean }).__crmGo = true;
        return;
      }
      if ((window as Window & { __crmGo?: boolean }).__crmGo) {
        const key = event.key.toLowerCase();
        const destination =
          key === 'h'
            ? 'today'
            : key === 't'
              ? 'tasks'
              : key === 'w'
                ? 'workflows'
                : key === 'p'
                  ? 'pipeline'
                  : key === 'r'
                    ? 'reports'
                    : key === 'f'
                      ? 'firm-setup'
                      : key === 'm'
                        ? 'migration'
                        : null;
        if (destination) {
          event.preventDefault();
          jump(destination);
        }
        (window as Window & { __crmGo?: boolean }).__crmGo = false;
      }
      if (event.key === '/' && route !== 'tasks') {
        document
          .querySelector<HTMLInputElement>('[data-testid="crm-ask-input"]')
          ?.focus();
      }
      if (route === 'propagation' && event.key.toLowerCase() === 'u') {
        event.preventDefault();
        reportUndo();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [activeAdapter, reportUndo, route]);
  const workflowWorkItems = activeAdapter.workflowWorkItems ?? [];
  const firmMembers = activeAdapter.firmMembers ?? [];
  const completeWorkItem = async (item: CrmDailyWorkItem) => {
    if (item.kind === 'workflow_step')
      await activeAdapter.actions.completeWorkflowWorkItem?.(item);
    else await updateTask({ ...item, status: 'done' });
  };
  const legacySurfaceContent = {
    today: (
      <Today
        workItems={dailyWorkItems(activeAdapter.tasks, workflowWorkItems)}
        firmMembers={firmMembers}
        approvals={approvals}
        activity={activity}
        freshness={freshness}
        onNavigate={jump}
        onCompleteWorkItem={completeWorkItem}
        onDecideApproval={(approval, decision) =>
          activeAdapter.actions.decideApproval?.(approval, decision)
        }
      />
    ),
    tasks: (
      <Tasks
        tasks={activeAdapter.tasks}
        workflowWorkItems={workflowWorkItems}
        firmMembers={firmMembers}
        households={activeAdapter.households ?? []}
        savedViews={savedTaskViews}
        freshness={freshness}
        onUpdateTask={updateTask}
        onCompleteWorkflowWorkItem={(item) =>
          activeAdapter.actions.completeWorkflowWorkItem?.(item)
        }
        onSaveView={(view) => activeAdapter.actions.saveTaskView?.(view)}
      />
    ),
    workflows:
      workflowData && workflowHouseholds && saveLiveRecord ? (
        <LiveWorkflows
          data={workflowData}
          households={workflowHouseholds}
          onSave={saveLiveRecord}
          onNavigate={jump}
        />
      ) : (
        <Workflows freshness={freshness} onNavigate={jump} />
      ),
    propagation:
      workflowData && saveLiveRecord ? (
        <LivePropagationReview data={workflowData} onSave={saveLiveRecord} />
      ) : (
        <PropagationReview
          offers={offers}
          freshness={freshness}
          onApply={(selected) =>
            activeAdapter.actions.applyPropagation?.(selected)
          }
          onUndo={reportUndo}
          undoReport={undoReport}
        />
      ),
    migration: (
      <Migration
        route={route}
        freshness={freshness}
        migration={activeAdapter.migration}
        onNavigate={jump}
        actions={activeAdapter.actions}
      />
    ),
    'fields-tags': <FieldsTags />,
    'intake-links': <IntakeLinks />,
  };
  const selectedSurface =
    crmHomeSurfaceRegistry.find((surface) => surface.route === route) ??
    crmHomeSurfaceRegistry.find((surface) => surface.route === 'firm-setup')!;
  const content = (
    <CrmHomeSurfaceContext.Provider
      value={{
        navigate: (next) => {
          jump(next as CrmHomeRoute);
        },
        renderLegacySurface: (id) =>
          legacySurfaceContent[id as keyof typeof legacySurfaceContent] ?? null,
      }}
    >
      {createElement(selectedSurface.Component)}
    </CrmHomeSurfaceContext.Provider>
  );
  return (
    <div
      data-testid="crm-home"
      style={{
        display: 'flex',
        height: '100%',
        minHeight: 0,
        position: 'relative',
        background: 'var(--color-background)',
      }}
    >
      {preview && (
        <div
          data-testid="crm-home-preview-label"
          role="status"
          style={{
            position: 'absolute',
            zIndex: 20,
            right: 16,
            bottom: 12,
            ...panelStyle,
            padding: 8,
            borderColor: 'var(--kp-direct)',
          }}
        >
          Preview mode. Not connected to CRM data.
        </div>
      )}
      <HomeRail route={route} onNavigate={jump} />
      <div
        style={{
          flex: 1,
          minWidth: 0,
          minHeight: 0,
          display: 'flex',
          position: 'relative',
        }}
      >
        {content}
        <button
          data-testid="crm-notifications-button"
          aria-label="Open notifications"
          onClick={() => {
            jump('activity');
          }}
          style={{
            position: 'absolute',
            top: 15,
            right: 18,
            border: 0,
            background: 'transparent',
            cursor: 'pointer',
            color: 'var(--kp-navy)',
          }}
        >
          <Bell size={20} />{' '}
          <span aria-label="Open notifications">Notifications</span>
        </button>
      </div>
    </div>
  );
}

export function CrmHome({
  adapter,
  preview = false,
  initialRoute,
}: CrmHomeProps) {
  const [freshness, setFreshness] = useState<CrmFreshnessState>(
    getCrmEngineFreshness()
  );
  const live = useLiveCrmRecords();
  useEffect(() => subscribeCrmEngineFreshness(setFreshness), []);
  const households = live.records
    .filter(
      (record) =>
        record.kind === 'household' && typeof record['name'] === 'string'
    )
    .map((record) => ({ id: record.id, name: record['name'] as string }));
  const firmMembers: readonly CrmFirmMember[] = live.records
    .filter(
      (record) =>
        record.kind === 'firmDirectoryEntry' &&
        record['active'] === true &&
        typeof record['userId'] === 'string' &&
        typeof record['displayName'] === 'string'
    )
    .map((record) => ({
      userId: record['userId'] as string,
      displayName: record['displayName'] as string,
      ...(typeof record['title'] === 'string'
        ? { title: record['title'] }
        : {}),
    }));
  const householdName = (id: string | undefined) =>
    households.find((household) => household.id === id)?.name;
  const contextIds = (record: Record<string, unknown>): string[] =>
    Array.isArray(record['contextRefs'])
      ? record['contextRefs'].flatMap((value) =>
          typeof value === 'string'
            ? [value]
            : value &&
                typeof value === 'object' &&
                typeof (value as { id?: unknown }).id === 'string'
              ? [(value as { id: string }).id]
              : []
        )
      : [];
  const householdIdFor = (
    record: Record<string, unknown>
  ): string | undefined => {
    const ref = record['householdRef'];
    return ref &&
      typeof ref === 'object' &&
      typeof (ref as { id?: unknown }).id === 'string'
      ? (ref as { id: string }).id
      : contextIds(record)[0];
  };
  const liveTasks: readonly CrmTask[] = live.records
    .filter((record) => record.kind === 'task')
    .map((record) => {
      const householdId = householdIdFor(record);
      const recurrence = record['recurrence'];
      const recurrenceFrequencyValue = (recurrence as { freq?: unknown } | null)
        ?.freq;
      const recurrenceFrequency =
        typeof recurrenceFrequencyValue === 'string'
          ? recurrenceFrequencyValue
          : '';
      const validRecurrence =
        recurrence &&
        typeof recurrence === 'object' &&
        ['daily', 'weekly', 'monthly', 'yearly'].includes(recurrenceFrequency)
          ? {
              freq: recurrenceFrequency as NonNullable<
                CrmTask['recurrence']
              >['freq'],
              interval: Math.max(
                1,
                Number((recurrence as { interval?: unknown }).interval) || 1
              ),
              regenerateOnComplete:
                (recurrence as { regenerateOnComplete?: unknown })
                  .regenerateOnComplete !== false,
            }
          : undefined;
      return {
        id: record.id,
        title:
          typeof record['title'] === 'string'
            ? record['title']
            : 'Untitled task',
        ...(typeof record['body'] === 'string' ? { body: record['body'] } : {}),
        assigneeUserId:
          typeof record['assigneeUserId'] === 'string'
            ? record['assigneeUserId']
            : null,
        ...(firmMembers.find(
          (member) => member.userId === record['assigneeUserId']
        )
          ? {
              assigneeLabel: firmMembers.find(
                (member) => member.userId === record['assigneeUserId']
              )?.displayName,
            }
          : {}),
        status:
          record['status'] === 'in_progress' ||
          record['status'] === 'blocked' ||
          record['status'] === 'done' ||
          record['status'] === 'cancelled'
            ? record['status']
            : 'open',
        priority:
          record['priority'] === 'high' || record['priority'] === 'low'
            ? record['priority']
            : 'normal',
        ...(householdId
          ? { householdId, householdLabel: householdName(householdId) }
          : {}),
        ...(typeof record['due'] === 'string'
          ? { dueAt: record['due'], dueLabel: record['due'] }
          : typeof record['dueAt'] === 'string'
            ? { dueAt: record['dueAt'], dueLabel: record['dueAt'] }
            : {}),
        ...(validRecurrence
          ? { recurrence: validRecurrence, recurrenceLabel: 'Recurring' }
          : {}),
        contextRefs: contextIds(record),
      };
    });
  const liveWorkflowWorkItems: readonly CrmWorkflowWorkItem[] = workflowRecords(
    live.records
  ).instances.flatMap((instance) =>
    Object.values(instance.snapshot.steps)
      .filter((step) => !step.hiddenByTemplateRemoval && step.status !== 'done')
      .map((step) => {
        const assigneeUserId = step.assigneeUserId ?? null;
        const member = firmMembers.find(
          (candidate) => candidate.userId === assigneeUserId
        );
        const dueValue = stepValue(instance, step.stepId, 'dueOffset');
        const offset = typeof dueValue === 'number' ? dueValue : undefined;
        const started = new Date(
          instance['createdAt'] ?? new Date().toISOString()
        );
        if (offset !== undefined)
          started.setUTCDate(started.getUTCDate() + offset);
        return {
          id: `${instance.id}:${step.stepId}`,
          instanceId: instance.id,
          stepId: step.stepId,
          title: liveStepTitle(instance, step.stepId),
          householdId: instance.householdId,
          householdLabel: instance.householdLabel,
          assigneeUserId,
          ...(member ? { assigneeLabel: member.displayName } : {}),
          status: step.status === 'in_progress' ? 'in_progress' : 'open',
          priority: 'normal' as const,
          ...(offset !== undefined
            ? { dueAt: started.toISOString().slice(0, 10) }
            : {}),
        };
      })
  );
  const liveApprovals: readonly CrmApproval[] = live.records
    .filter((record) => record.kind === 'proposalRecord')
    .map((record) => {
      const householdId = householdIdFor(record);
      const proposalKind =
        typeof record['proposalKind'] === 'string'
          ? record['proposalKind'].replaceAll('_', ' ')
          : 'proposed change';
      return {
        id: record.id,
        title:
          typeof record['title'] === 'string'
            ? record['title']
            : `Review ${proposalKind}`,
        ...(typeof record['rationale'] === 'string'
          ? { rationale: record['rationale'] }
          : {}),
        ...(householdId ? { householdLabel: householdName(householdId) } : {}),
        state:
          record['state'] === 'approved' ||
          record['state'] === 'rejected' ||
          record['state'] === 'expired'
            ? record['state']
            : 'pending',
        ...(typeof record['decidedAt'] === 'string'
          ? { decidedAt: record['decidedAt'] }
          : {}),
      };
    });
  const liveActivity: readonly CrmActivity[] = live.records
    .filter(
      (record) =>
        record.kind === 'activityEvent' && typeof record['at'] === 'string'
    )
    .map((record) => ({
      id: record.id,
      summary:
        typeof record['summary'] === 'string'
          ? record['summary']
          : 'CRM activity recorded',
      at: record['at'] as string,
    }));
  const savedTaskViews: readonly CrmTaskSavedView[] = live.records
    .filter(
      (record) => record.kind === 'savedView' && record['surface'] === 'tasks'
    )
    .map((record) => ({
      id: record.id,
      name: typeof record['name'] === 'string' ? record['name'] : 'Saved view',
      layout:
        record['layout'] === 'kanban' || record['layout'] === 'table'
          ? record['layout']
          : 'list',
      ...(typeof (record['query'] as { search?: unknown } | undefined)
        ?.search === 'string'
        ? { search: (record['query'] as { search: string }).search }
        : {}),
    }));
  const liveWorkflowChecklists: readonly MigrationWorkflowChecklist[] =
    live.records
      .filter((record) => record.kind === 'migration_workflow_checklist')
      .map((record) => ({
        id: record.id,
        ...(typeof record['householdId'] === 'string'
          ? { householdId: record['householdId'] }
          : {}),
        clientLabel:
          typeof record['clientLabel'] === 'string'
            ? record['clientLabel']
            : 'Imported client',
        sourceTemplateLabel:
          typeof record['sourceTemplateLabel'] === 'string'
            ? record['sourceTemplateLabel']
            : 'Imported workflow',
        activityEvidence: Array.isArray(record['activityEvidence'])
          ? record['activityEvidence'].filter(
              (item): item is string => typeof item === 'string'
            )
          : [],
        availableSteps: Array.isArray(record['availableSteps'])
          ? record['availableSteps'].filter(
              (item): item is string => typeof item === 'string'
            )
          : [],
        ...(typeof record['selectedCurrentStep'] === 'string'
          ? { selectedCurrentStep: record['selectedCurrentStep'] }
          : {}),
        evidenceReviewed: record['evidenceReviewed'] === true,
        decision:
          record['decision'] === 'recreate' || record['decision'] === 'gap'
            ? record['decision']
            : 'pending',
        ...(typeof record['resultingInstanceLabel'] === 'string'
          ? { resultingInstanceLabel: record['resultingInstanceLabel'] }
          : {}),
        ...(typeof record['gapReason'] === 'string'
          ? { gapReason: record['gapReason'] }
          : {}),
      }));
  const liveAttachmentAccounting: readonly AttachmentAccountingRecord[] =
    live.records
      .filter((record) => record.kind === 'migration_attachment_accounting')
      .map((record) => ({
        id: record.id,
        clientLabel:
          typeof record['clientLabel'] === 'string'
            ? record['clientLabel']
            : 'Imported client',
        status:
          record['status'] === 'exported' || record['status'] === 'gap'
            ? record['status']
            : 'pending',
        ...(typeof record['exportSource'] === 'string'
          ? { exportSource: record['exportSource'] }
          : {}),
        ...(typeof record['exportedBy'] === 'string'
          ? { exportedBy: record['exportedBy'] }
          : {}),
        ...(typeof record['gapReason'] === 'string'
          ? { gapReason: record['gapReason'] }
          : {}),
        ...(typeof record['gapOwner'] === 'string'
          ? { gapOwner: record['gapOwner'] }
          : {}),
      }));
  const liveNoteGaps: readonly MigrationNoteGap[] = live.records
    .filter((record) => record.kind === 'migration_note_gap')
    .map((record) => ({
      id: record.id,
      label:
        typeof record['label'] === 'string' ? record['label'] : 'Untitled note',
      reason:
        typeof record['reason'] === 'string'
          ? record['reason']
          : 'This note could not be safely linked to a client.',
    }));
  const reportRecord = live.records.find(
    (record) => record.kind === 'migration_report'
  );
  const liveReport: MigrationFidelityReport | undefined =
    reportRecord &&
    Array.isArray(reportRecord['matrix']) &&
    typeof reportRecord['batchId'] === 'string' &&
    typeof reportRecord['generatedAt'] === 'string' &&
    typeof reportRecord['message'] === 'string' &&
    reportRecord['attachments'] &&
    typeof reportRecord['attachments'] === 'object' &&
    reportRecord['workflows'] &&
    typeof reportRecord['workflows'] === 'object'
      ? (reportRecord as unknown as MigrationFidelityReport)
      : undefined;
  const liveExports: readonly ExportJobStatus[] = (
    ['archive', 'rollback'] as const
  ).map((kind) => {
    const record = live.records.find(
      (item) => item.kind === 'migration_export' && item['exportKind'] === kind
    );
    return {
      kind,
      status:
        record?.['status'] === 'exported' ||
        record?.['status'] === 'preparing' ||
        record?.['status'] === 'failed'
          ? record['status']
          : 'ready',
      ...(typeof record?.['exportedAt'] === 'string'
        ? { exportedAt: record['exportedAt'] }
        : {}),
      ...(typeof record?.['manifestId'] === 'string'
        ? { manifestId: record['manifestId'] }
        : {}),
      ...(typeof record?.['reconciliationReportId'] === 'string'
        ? { reconciliationReportId: record['reconciliationReportId'] }
        : {}),
      ...(typeof record?.['filePath'] === 'string'
        ? { filePath: record['filePath'] }
        : {}),
      ...(typeof record?.['byteLength'] === 'number'
        ? { byteLength: record['byteLength'] }
        : {}),
      ...(typeof record?.['sha256'] === 'string'
        ? { sha256: record['sha256'] }
        : {}),
      ...(typeof record?.['failureReason'] === 'string'
        ? { failureReason: record['failureReason'] }
        : {}),
    };
  });
  const recordActivity = async (
    summary: string,
    task?: CrmTask,
    verb = 'task.updated'
  ) => {
    const now = new Date().toISOString();
    await live.save({
      id: `activity-${crypto.randomUUID()}`,
      kind: 'activityEvent',
      matterId: 'firm_home',
      at: now,
      summary,
      actor: { userId: 'local-user', displayName: 'You' },
      verb,
      targetRef: task
        ? {
            kind: 'task',
            id: task.id,
            ...(task.householdId ? { matterId: task.householdId } : {}),
          }
        : { kind: 'firmDoc', id: 'firm_home' },
      ...(task?.householdId ? { householdId: task.householdId } : {}),
      payload: task ? { taskId: task.id, status: task.status } : {},
      important: false,
    });
  };
  const saveTask = async (task: CrmTask) => {
    const householdId = task.householdId ?? task.contextRefs?.[0];
    const previous = liveTasks.find((item) => item.id === task.id);
    const householdRef = householdId
      ? { kind: 'household', id: householdId, matterId: householdId }
      : null;
    await live.save({
      id: task.id,
      kind: 'task',
      matterId: 'firm_home',
      title: task.title.trim(),
      body: task.body ?? '',
      assigneeUserId: task.assigneeUserId,
      status: task.status,
      ...(task.dueAt ? { due: task.dueAt } : {}),
      priority: task.priority,
      ...(task.recurrence ? { recurrence: task.recurrence } : {}),
      householdRef,
      contextRefs: householdRef ? [householdRef] : [],
      customFields: {},
    });
    await recordActivity(
      task.status === 'done' && previous?.status !== 'done'
        ? `Completed task: ${task.title}`
        : previous
          ? `Updated task: ${task.title}`
          : `Created task: ${task.title}`,
      { ...task, ...(householdId ? { householdId } : {}) },
      task.status === 'done' && previous?.status !== 'done'
        ? 'task.completed'
        : previous
          ? 'task.updated'
          : 'task.created'
    );
    if (
      task.status === 'done' &&
      previous?.status !== 'done' &&
      task.recurrence?.regenerateOnComplete
    ) {
      const dueAt = nextRecurringDue(task.dueAt, task.recurrence);
      const child: CrmTask = {
        ...task,
        id: `task-${crypto.randomUUID()}`,
        status: 'open',
        ...(dueAt ? { dueAt, dueLabel: dueAt } : {}),
      };
      await live.save({
        id: child.id,
        kind: 'task',
        matterId: 'firm_home',
        title: child.title,
        body: child.body ?? '',
        assigneeUserId: child.assigneeUserId,
        status: 'open',
        ...(dueAt ? { due: dueAt } : {}),
        priority: child.priority,
        recurrence: child.recurrence,
        householdRef,
        contextRefs: householdRef ? [householdRef] : [],
        customFields: {},
      });
      await recordActivity(
        `Created next recurring task: ${child.title}`,
        child
      );
    }
  };
  const completeWorkflowWorkItem = async (item: CrmWorkflowWorkItem) => {
    const instance = workflowRecords(live.records).instances.find(
      (candidate) => candidate.id === item.instanceId
    );
    if (!instance)
      throw new Error('That workflow step is no longer available.');
    await live.save(completeWorkflowStep(instance, item.stepId));
    const now = new Date().toISOString();
    await live.save({
      id: `activity-${crypto.randomUUID()}`,
      kind: 'activityEvent',
      matterId: 'firm_home',
      at: now,
      summary: `Completed workflow step: ${item.title}`,
      actor: { userId: 'local-user', displayName: 'You' },
      verb: 'workflow.step.done',
      targetRef: {
        kind: 'workflowInstance',
        id: item.instanceId,
        matterId: item.householdId,
      },
      householdId: item.householdId,
      payload: { stepId: item.stepId },
      important: false,
    });
  };
  const liveAdapter: CrmHomeAdapter = {
    ...emptyEngineAdapter(freshness),
    tasks: liveTasks,
    households,
    firmMembers,
    workflowWorkItems: liveWorkflowWorkItems,
    approvals: liveApprovals,
    activity: liveActivity,
    savedTaskViews,
    migration: {
      noteGaps: liveNoteGaps,
      workflowChecklists: liveWorkflowChecklists,
      attachmentAccounting: liveAttachmentAccounting,
      exports: liveExports,
      ...(liveReport ? { report: liveReport } : {}),
    },
    actions: {
      updateTask: saveTask,
      completeWorkflowWorkItem,
      recordWorkflowChecklist: async (record) => {
        if (record.decision !== 'recreate') {
          await live.save({
            ...record,
            kind: 'migration_workflow_checklist',
            matterId: 'firm',
          });
          return;
        }
        const household =
          (record.householdId
            ? households.find((item) => item.id === record.householdId)
            : undefined) ??
          households.find((item) => item.name === record.clientLabel);
        if (!household)
          throw new Error(
            'Choose the client for this imported workflow before creating it.'
          );
        if (
          !record.selectedCurrentStep ||
          !record.availableSteps.includes(record.selectedCurrentStep)
        )
          throw new Error(
            'Choose the workflow’s current step before creating it.'
          );
        let template = workflowRecords(live.records).templates.find(
          (item) => item.name === record.sourceTemplateLabel
        );
        if (!template) {
          if (!record.availableSteps.length)
            throw new Error(
              'This imported workflow has no readable steps. Record it as a trace gap instead.'
            );
          template = createTemplate(
            record.sourceTemplateLabel,
            record.availableSteps
          );
          await live.save(template);
        }
        let instance = startWorkflow(template, {
          id: household.id,
          label: household.name,
        });
        const currentStepIndex = template.steps.findIndex(
          (step) => step.title === record.selectedCurrentStep
        );
        for (const step of template.steps.slice(
          0,
          Math.max(0, currentStepIndex)
        ))
          instance = completeWorkflowStep(instance, step.id);
        await live.save(instance);
        await live.save({
          ...record,
          householdId: household.id,
          kind: 'migration_workflow_checklist',
          matterId: 'firm',
          resultingInstanceLabel: instance.name,
          resultingWorkflowInstanceRef: instance.id,
        });
      },
      recordAttachmentAccounting: async (record) => {
        await live.save({
          ...record,
          kind: 'migration_attachment_accounting',
          matterId: 'firm',
        });
      },
      createExport: (kind) => {
        void createMigrationExport(live.workspaceRoot, kind).then(() =>
          live.reload()
        );
      },
      retryExport: (kind) => {
        void createMigrationExport(live.workspaceRoot, kind).then(() =>
          live.reload()
        );
      },
      runMigrationImport: async (baseUrl) => {
        await runWealthboxMigration(live.workspaceRoot, baseUrl);
        await live.reload();
      },
      saveTaskView: async (view) => {
        await live.save({
          id: view.id,
          kind: 'savedView',
          matterId: 'firm_home',
          name: view.name,
          surface: 'tasks',
          layout: view.layout,
          query: {
            entity: 'task',
            filters: [],
            ...(view.search ? { search: view.search } : {}),
          },
          visibility: 'personal',
        });
        await recordActivity(`Saved task view: ${view.name}`);
      },
      decideApproval: async (approval, decision) => {
        const record = live.records.find(
          (item) => item.id === approval.id && item.kind === 'proposalRecord'
        );
        if (!record) throw new Error('This approval is no longer available.');
        const decidedAt = new Date().toISOString();
        let appliedEntityRef:
          | { kind: 'workflowInstance'; id: string; matterId: string }
          | undefined;
        if (
          decision === 'approved' &&
          record['proposalKind'] === 'workflow_launch'
        ) {
          const proposed = record['proposedMutation'] as
            | { workflowTemplateId?: unknown }
            | undefined;
          const templateId =
            typeof proposed?.workflowTemplateId === 'string'
              ? proposed.workflowTemplateId
              : undefined;
          const householdId = householdIdFor(record);
          const template = templateId
            ? workflowRecords(live.records).templates.find(
                (item) => item.id === templateId
              )
            : undefined;
          const household = householdId
            ? workflowHouseholds.find((item) => item.id === householdId)
            : undefined;
          if (!template || !household)
            throw new Error(
              'This proposed workflow no longer has a template and household to start.'
            );
          const instance = startWorkflow(template, household);
          await live.save(instance);
          appliedEntityRef = {
            kind: 'workflowInstance',
            id: instance.id,
            matterId: household.id,
          };
        }
        await live.save({
          ...record,
          state: decision,
          decidedAt,
          decidedBy: { userId: 'local-user', displayName: 'You' },
          ...(appliedEntityRef ? { appliedEntityRef } : {}),
        });
        if (
          decision === 'approved' &&
          record['proposalKind'] === 'task_create'
        ) {
          const proposed = record['proposedMutation'] as
            | { task?: Partial<CrmTask> }
            | undefined;
          const proposalTask = proposed?.task;
          if (proposalTask?.title)
            await saveTask({
              id: `task-${record.id}`,
              title: proposalTask.title,
              body: '',
              assigneeUserId: proposalTask.assigneeUserId ?? null,
              status: 'open',
              priority: proposalTask.priority ?? 'normal',
              ...(proposalTask.householdId
                ? { householdId: proposalTask.householdId }
                : householdIdFor(record)
                  ? { householdId: householdIdFor(record) }
                  : {}),
              ...(proposalTask.dueAt ? { dueAt: proposalTask.dueAt } : {}),
              contextRefs: proposalTask.contextRefs ?? [],
            });
        }
        await recordActivity(
          `${decision === 'approved' ? 'Approved' : 'Dismissed'} proposal: ${approval.title}`
        );
      },
    },
  };
  const activeAdapter = adapter ?? (preview ? PREVIEW_ADAPTER : liveAdapter);
  const workflowHouseholds = useMemo<HouseholdChoice[]>(
    () =>
      live.records
        .filter((record) => record.kind === 'household')
        .map((record) => ({
          id: record.id,
          label:
            typeof record['name'] === 'string'
              ? record['name']
              : typeof record['label'] === 'string'
                ? record['label']
                : 'Untitled household',
        })),
    [live.records]
  );
  // Scheduling is client-computed from encrypted records. It runs whenever the
  // CRM home is open, not only while a person is looking at the Workflows tab.
  useEffect(() => {
    if (adapter || preview) return;
    let cancelled = false;
    void (async () => {
      for (const template of workflowRecords(live.records).templates) {
        const scheduled = startScheduledWorkflows(template, workflowHouseholds);
        if (!scheduled.instances.length || cancelled) continue;
        for (const instance of scheduled.instances) {
          if (cancelled) return;
          await live.save(instance);
        }
        if (!cancelled) await live.save(scheduled.template);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [adapter, live.records, live.save, preview, workflowHouseholds]);
  const liveWorkflowProps =
    adapter || preview
      ? {}
      : {
          workflowData: workflowRecords(live.records),
          workflowHouseholds,
          saveLiveRecord: live.save,
        };
  return (
    <ConnectedCrmHome
      adapter={activeAdapter}
      preview={preview}
      {...liveWorkflowProps}
      {...(initialRoute ? { initialRoute } : {})}
    />
  );
}

export default CrmHome;
