/* eslint-disable lantern-i18n/no-hardcoded-string -- Frozen CRM screen copy needs its translation catalog in a separate product change. */
import { useState } from 'react';
import { ListChecks } from 'lucide-react';
import { Button } from '@/ui/kp';
import { buildCapacityTriage } from '@/platform/crm/tasks';
import {
  AskBar,
  FreshnessBanner,
  Screen,
  mutedStyle,
  panelStyle,
} from '@/features/crm-home/shared/ui';
import { dailyWorkItems } from '@/features/crm-home/shared/workItems';
import type {
  CrmFreshnessState,
  CrmFirmMember,
  CrmTask,
  CrmTaskSavedView,
  CrmWorkflowWorkItem,
} from '@/features/crm-home/types';
import { useCrmHomeSurfaceContext } from '@/features/crm-home/surfaceContext';
import type { CrmHouseholdAddRequest } from '@/features/crm-home/routes';
import {
  getTaskTemplates,
  mountTaskActions,
  mountTaskFields,
  mountTaskTemplates,
} from './taskExtensionRegistry';

type TaskPriority = CrmTask['priority'];

const PRIORITY_PRESENTATION: Record<
  TaskPriority,
  {
    label: string;
    symbol: string;
    color: string;
    background: string;
    border: string;
  }
> = {
  high: {
    label: 'High priority',
    symbol: '▲',
    color: 'var(--kp-warning)',
    background: 'var(--kp-warning-bg)',
    border: 'var(--kp-warning-line)',
  },
  normal: {
    label: 'Normal priority',
    symbol: '◆',
    color: 'var(--kp-text-dim)',
    background: 'var(--kp-bg-soft)',
    border: 'var(--kp-divider-strong)',
  },
  low: {
    label: 'Low priority',
    symbol: '▼',
    color: 'var(--kp-local)',
    background: 'var(--kp-local-bg)',
    border: 'var(--kp-local-line)',
  },
};

function normalizeTaskPriority(priority: unknown): TaskPriority {
  return priority === 'high' || priority === 'low' ? priority : 'normal';
}

function PriorityBadge({
  priority,
  testId,
  announce = false,
}: {
  priority: unknown;
  testId: string;
  announce?: boolean;
}) {
  const presentation = PRIORITY_PRESENTATION[normalizeTaskPriority(priority)];
  return (
    <span
      data-testid={testId}
      role={announce ? 'status' : 'img'}
      aria-label={presentation.label}
      aria-live={announce ? 'polite' : undefined}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        padding: '2px 7px',
        border: `1px solid ${presentation.border}`,
        borderRadius: 999,
        color: presentation.color,
        background: presentation.background,
        fontSize: 12,
        fontWeight: 700,
        lineHeight: 1.4,
        whiteSpace: 'nowrap',
      }}
    >
      <span aria-hidden="true">{presentation.symbol}</span>
      <span aria-hidden="true">{presentation.label}</span>
    </span>
  );
}

export function Tasks({
  tasks,
  workflowWorkItems,
  firmMembers,
  households,
  savedViews,
  freshness,
  onUpdateTask,
  onCompleteWorkflowWorkItem,
  onSaveView,
  addRequest,
  onAddRequestConsumed,
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
  addRequest?: CrmHouseholdAddRequest;
  onAddRequestConsumed?: () => void;
}) {
  const [view, setView] = useState<'list' | 'board'>('list');
  const [filter, setFilter] = useState('');
  const [addRequestDraft] = useState<CrmTask | null>(() =>
    addRequest?.kind === 'task'
      ? (getTaskTemplates().find((descriptor) => descriptor.create)?.create?.(addRequest) ?? null)
      : null
  );
  const [editing, setEditing] = useState<CrmTask | null>(addRequestDraft);
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
  return (
    <Screen
      title="Tasks"
      description="One work list for tasks and workflow steps"
      Icon={ListChecks}
      action={mountTaskTemplates({
        ...(addRequest ? { addRequest } : {}),
        ...(onAddRequestConsumed ? { onAddRequestConsumed } : {}),
        onApplied: () => {
          setEditing((current) => current?.id === addRequestDraft?.id ? null : current);
        },
        onCreate: setEditing,
      })}
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
        {mountTaskActions({
          tasks,
          workflowWorkItems,
          compatibilityMount: (
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
          ),
        })}
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
        <section data-testid="crm-unified-work-list">
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
        </section>
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
            onAddRequestConsumed?.();
          }}
          onSave={onUpdateTask}
        />
      )}
    </Screen>
  );
}

export function TasksSurface() {
  const { adapter, addRequest, onAddRequestConsumed } =
    useCrmHomeSurfaceContext();
  return (
    <Tasks
      tasks={adapter.tasks}
      workflowWorkItems={adapter.workflowWorkItems ?? []}
      firmMembers={adapter.firmMembers ?? []}
      households={adapter.households ?? []}
      savedViews={adapter.savedTaskViews ?? []}
      freshness={adapter.freshness}
      onUpdateTask={(task) => adapter.actions.updateTask?.(task)}
      onCompleteWorkflowWorkItem={(item) =>
        adapter.actions.completeWorkflowWorkItem?.(item)
      }
      onSaveView={(view) => adapter.actions.saveTaskView?.(view)}
      {...(addRequest ? { addRequest } : {})}
      {...(onAddRequestConsumed ? { onAddRequestConsumed } : {})}
    />
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
      data-testid={`crm-task-record-${task.id}`}
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
        <strong data-testid={`crm-task-title-${task.id}`}>{task.title}</strong>
        <span style={mutedStyle}>
          {' '}
          · {task.householdLabel ?? 'No client'} ·{' '}
          <PriorityBadge
            priority={task.priority}
            testId={`crm-task-priority-label-${task.id}`}
          />{' '}
          · {task.dueLabel ?? 'No due date'} ·{' '}
          <span data-testid={`crm-task-assignee-label-${task.id}`}>
            {task.assigneeLabel ?? task.assigneeUserId ?? 'Unassigned'}
          </span>
          {task.recurrence && (
            <span data-testid={`crm-task-recurrence-label-${task.id}`}>
              {' '}
              · Recurring
            </span>
          )}
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
  const [draft, setDraft] = useState<CrmTask>(() => ({
    ...task,
    priority: normalizeTaskPriority(task.priority),
  }));
  const [saving, setSaving] = useState(false);
  const [fieldPersistenceBusy, setFieldPersistenceBusy] = useState(false);
  const householdId = draft.householdId ?? draft.contextRefs?.[0] ?? '';
  const selectHousehold = (id: string) => {
    const household = households.find((item) => item.id === id);
    setDraft({
      ...draft,
      householdId: id || undefined,
      householdLabel: household?.name,
      contextRefs: id ? [id] : [],
    });
  };
  const setRecurrence = (freq: string) => {
    setDraft({
      ...draft,
      recurrence: freq
        ? {
            freq: freq as NonNullable<CrmTask['recurrence']>['freq'],
            interval: draft.recurrence?.interval ?? 1,
            regenerateOnComplete: true,
          }
        : undefined,
    });
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
      {mountTaskFields({
        task: draft,
        updateTask: setDraft,
        setPersistenceBusy: setFieldPersistenceBusy,
        households,
        firmMembers,
        compatibilityMount: (
          <>
            <label>
              Title
              <input
                data-testid="crm-task-title-input"
                value={draft.title}
                onChange={(event) => {
                  setDraft({ ...draft, title: event.target.value });
                }}
              />
            </label>
            <label>
              Notes
              <textarea
                data-testid="crm-task-body"
                value={draft.body ?? ''}
                onChange={(event) => {
                  setDraft({ ...draft, body: event.target.value });
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
                  setDraft({
                    ...draft,
                    assigneeUserId: member?.userId ?? null,
                    assigneeLabel: member?.displayName,
                  });
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
                  setDraft({
                    ...draft,
                    status: event.target.value as CrmTask['status'],
                  });
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
                aria-label={`Task priority: ${PRIORITY_PRESENTATION[draft.priority].label}`}
                onChange={(event) => {
                  setDraft({
                    ...draft,
                    priority: event.target.value as CrmTask['priority'],
                  });
                }}
              >
                <option value="high">High priority</option>
                <option value="normal">Normal priority</option>
                <option value="low">Low priority</option>
              </select>
              <PriorityBadge
                priority={task.priority}
                testId="crm-task-priority-preview"
                announce
              />
            </label>
            <label>
              Due date
              <input
                data-testid="crm-task-due"
                type="date"
                value={draft.dueAt ?? ''}
                onChange={(event) => {
                  const due = event.target.value;
                  setDraft({
                    ...draft,
                    dueAt: due || undefined,
                    dueLabel: due || undefined,
                  });
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
                    setDraft({
                      ...draft,
                      recurrence: {
                        ...recurrence,
                        interval: Math.max(1, Number(event.target.value) || 1),
                      },
                    });
                  }}
                />
              </label>
            )}
            <p style={mutedStyle}>
              One assignee. Notes live in the task body. Tasks have no comments.
            </p>
          </>
        ),
      })}
      <div style={{ display: 'flex', gap: 8 }}>
        <Button
          data-testid="crm-task-save"
          disabled={saving || fieldPersistenceBusy || !draft.title.trim()}
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
