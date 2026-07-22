/* eslint-disable lantern-i18n/no-hardcoded-string -- Frozen CRM screen copy needs its translation catalog in a separate product change. */
import { useState } from 'react';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { ListChecks, ListTodo, Workflow } from 'lucide-react';
import { Button } from '@/ui/kp';
import { ConfirmDialog } from '@/ui/ConfirmDialog';
import { useConfirmDialog } from '@/platform/hooks/useConfirmDialog';
import { buildCapacityTriage, dailyWorkSortFacts } from '@/platform/crm/tasks';
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
  useTaskRecordStore,
  type CreateTaskRecordInput,
  type TaskRecord,
} from '@/features/crm-tasks';
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
    symbol: string;
    color: string;
    background: string;
    border: string;
  }
> = {
  high: {
    symbol: '▲',
    color: 'var(--kp-warning)',
    background: 'var(--kp-warning-bg)',
    border: 'var(--kp-warning-line)',
  },
  normal: {
    symbol: '◆',
    color: 'var(--kp-text-dim)',
    background: 'var(--kp-bg-soft)',
    border: 'var(--kp-divider-strong)',
  },
  low: {
    symbol: '▼',
    color: 'var(--kp-local)',
    background: 'var(--kp-local-bg)',
    border: 'var(--kp-local-line)',
  },
};

function normalizeTaskPriority(priority: unknown): TaskPriority {
  return priority === 'high' || priority === 'low' ? priority : 'normal';
}

function priorityLabel(priority: unknown, t: TFunction): string {
  return t(`crmTasks.workList.priority.${normalizeTaskPriority(priority)}`);
}

function calendarDay(value: string | undefined): string | undefined {
  return value?.slice(0, 10);
}

function formattedDay(value: string, language: string): string {
  return new Intl.DateTimeFormat(language, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${value}T00:00:00Z`));
}

function dueFact(
  item: CrmTask | CrmWorkflowWorkItem,
  today: string,
  language: string,
  t: TFunction
): string {
  const due = calendarDay(item.dueAt);
  if (!due) return t('crmTasks.workList.due.none');
  if (due < today) return t('crmTasks.workList.due.overdue');
  if (due === today) return t('crmTasks.workList.due.today');
  return t('crmTasks.workList.due.onDate', {
    date: formattedDay(due, language),
  });
}

function rankReason(
  item: CrmTask | CrmWorkflowWorkItem,
  today: string,
  language: string,
  t: TFunction
): string {
  if (item.status === 'done' || item.status === 'cancelled') {
    return t('crmTasks.workList.rank.closed');
  }
  const facts = dailyWorkSortFacts(item, today);
  return t('crmTasks.workList.rank.reason', {
    due: dueFact(item, today, language, t),
    availability: t(
      facts.blocked
        ? 'crmTasks.workList.rank.blocked'
        : 'crmTasks.workList.rank.available'
    ),
    priority: priorityLabel(facts.priority, t),
    exactDue: facts.exactDueDay
      ? formattedDay(facts.exactDueDay, language)
      : t('crmTasks.workList.rank.noExactDate'),
    title: facts.title,
    id: facts.id,
  });
}

function duplicateTaskInput(source: TaskRecord): CreateTaskRecordInput {
  return {
    title: source.title,
    body: source.body,
    householdRef: source.householdRef ? { ...source.householdRef } : null,
    assigneeUserId: source.assigneeUserId,
    status: 'open',
    ...(source.due ? { due: source.due } : {}),
    ...(source.dueTime ? { dueTime: source.dueTime } : {}),
    ...(source.recurrence ? { recurrence: { ...source.recurrence } } : {}),
    priority: source.priority,
    ...(source.category ? { category: source.category } : {}),
    tagIds: [...source.tagIds],
    contextRefs: source.contextRefs.map((ref) => ({ ...ref })),
    ...(source.meetingVisibility
      ? { meetingVisibilityParent: source.meetingVisibility }
      : {}),
  };
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
  const { t } = useTranslation();
  const presentation = PRIORITY_PRESENTATION[normalizeTaskPriority(priority)];
  const label = priorityLabel(priority, t);
  return (
    <span
      data-testid={testId}
      role={announce ? 'status' : 'img'}
      aria-label={label}
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
      <span aria-hidden="true">{label}</span>
    </span>
  );
}

function WorkKindBadge({
  kind,
  testId,
}: {
  kind: 'task' | 'workflow_step';
  testId: string;
}) {
  const { t } = useTranslation();
  const workflow = kind === 'workflow_step';
  const Icon = workflow ? Workflow : ListTodo;
  const label = t(
    workflow
      ? 'crmTasks.workList.kind.workflowStep'
      : 'crmTasks.workList.kind.task'
  );
  return (
    <span
      data-testid={testId}
      style={{
        alignItems: 'center',
        background: workflow
          ? 'var(--kp-work-kind-workflow-bg)'
          : 'var(--kp-work-kind-task-bg)',
        border: `1px solid ${
          workflow
            ? 'var(--kp-work-kind-workflow-border)'
            : 'var(--kp-work-kind-task-border)'
        }`,
        borderRadius: 6,
        color: workflow
          ? 'var(--kp-work-kind-workflow-text)'
          : 'var(--kp-work-kind-task-text)',
        display: 'inline-flex',
        fontSize: 12,
        fontWeight: 800,
        gap: 5,
        letterSpacing: '0.01em',
        lineHeight: 1.4,
        padding: '3px 7px',
        whiteSpace: 'nowrap',
      }}
    >
      <Icon aria-hidden="true" size={14} strokeWidth={2.5} />
      {label}
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
  onOpenWorkflowWorkItem,
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
  onOpenWorkflowWorkItem: (item: CrmWorkflowWorkItem) => void;
  onSaveView: (view: CrmTaskSavedView) => void | Promise<void>;
  addRequest?: CrmHouseholdAddRequest;
  onAddRequestConsumed?: () => void;
}) {
  const { i18n, t } = useTranslation();
  const [view, setView] = useState<'list' | 'board'>('list');
  const [filter, setFilter] = useState('');
  const [addRequestDraft] = useState<CrmTask | null>(() =>
    addRequest?.kind === 'task'
      ? (getTaskTemplates()
          .find((descriptor) => descriptor.create)
          ?.create?.(addRequest) ?? null)
      : null
  );
  const [editing, setEditing] = useState<CrmTask | null>(addRequestDraft);
  const [savingView, setSavingView] = useState(false);
  const [viewName, setViewName] = useState('');
  const [pendingTaskActionId, setPendingTaskActionId] = useState<string | null>(
    null
  );
  const [taskActionError, setTaskActionError] = useState<string | null>(null);
  const taskStore = useTaskRecordStore();
  const { confirm, dialogProps: confirmDialogProps } = useConfirmDialog();
  const filtered = tasks.filter((task) =>
    task.title.toLowerCase().includes(filter.toLowerCase())
  );
  const filteredWorkflowSteps = workflowWorkItems.filter((item) =>
    item.title.toLowerCase().includes(filter.toLowerCase())
  );
  const workItems = dailyWorkItems(filtered, filteredWorkflowSteps);
  const orderedWorkItems = [
    ...buildCapacityTriage(workItems, []).ranked,
    ...workItems.filter(
      (item) => item.status === 'done' || item.status === 'cancelled'
    ),
  ];
  const today = new Date().toISOString().slice(0, 10);
  const language = i18n.resolvedLanguage ?? i18n.language;
  const filteredTasksById = new Map(filtered.map((task) => [task.id, task]));
  const filteredWorkflowStepsById = new Map(
    filteredWorkflowSteps.map((item) => [item.id, item])
  );
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
  const duplicateTask = async (task: CrmTask) => {
    setTaskActionError(null);
    setPendingTaskActionId(task.id);
    try {
      const source = await taskStore.get(task.id);
      if (!source) throw new Error('That task no longer exists.');
      const duplicate = await taskStore.create(duplicateTaskInput(source));
      setEditing({
        ...task,
        id: duplicate.id,
        title: duplicate.title,
        body: duplicate.body,
        assigneeUserId: duplicate.assigneeUserId,
        status: 'open',
        priority: duplicate.priority,
        tagIds: [...duplicate.tagIds],
      });
    } catch (reason: unknown) {
      setTaskActionError(
        reason instanceof Error
          ? reason.message
          : 'The task could not be duplicated.'
      );
    } finally {
      setPendingTaskActionId(null);
    }
  };
  const deleteTask = async (task: CrmTask) => {
    const confirmed = await confirm(`Move "${task.title}" to Trash?`, {
      title: 'Delete task',
      description:
        'The task will move to Trash, where it can be restored for 30 days.',
      confirmLabel: 'Delete',
      variant: 'destructive',
    });
    if (!confirmed) return;
    setTaskActionError(null);
    setPendingTaskActionId(task.id);
    try {
      await taskStore.remove(task.id);
      setEditing((current) => (current?.id === task.id ? null : current));
    } catch (reason: unknown) {
      setTaskActionError(
        reason instanceof Error
          ? reason.message
          : 'The task could not be deleted.'
      );
    } finally {
      setPendingTaskActionId(null);
    }
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
          setEditing((current) =>
            current?.id === addRequestDraft?.id ? null : current
          );
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
      {taskActionError && (
        <p data-testid="crm-task-action-error" role="alert" style={mutedStyle}>
          {taskActionError}
        </p>
      )}
      {view === 'list' ? (
        <section
          aria-labelledby="crm-work-list-order"
          data-testid="crm-unified-work-list"
          style={panelStyle}
        >
          <p
            data-testid="crm-work-list-order-explanation"
            id="crm-work-list-order"
            style={{ ...mutedStyle, margin: '0 0 10px' }}
          >
            {t('crmTasks.workList.orderExplanation')}
          </p>
          <div>
            {workItems.length === 0 ? (
              <p>
                {tasks.length === 0 && workflowWorkItems.length === 0
                  ? 'No work yet.'
                  : 'No work matches these filters.'}
              </p>
            ) : (
              <ol
                aria-describedby="crm-work-list-order"
                data-testid="crm-task-list"
                style={{ listStyle: 'none', margin: 0, padding: 0 }}
              >
                {orderedWorkItems.map((item, index) => {
                  const reason = rankReason(item, today, language, t);
                  if (item.kind === 'task') {
                    const task = filteredTasksById.get(item.id);
                    return task ? (
                      <TaskRow
                        key={task.id}
                        rank={index + 1}
                        rankReason={reason}
                        task={task}
                        onComplete={() => {
                          advance(task);
                        }}
                        onOpen={() => {
                          setEditing(task);
                        }}
                        onDuplicate={() => {
                          void duplicateTask(task).catch((reason: unknown) => {
                            setTaskActionError(
                              reason instanceof Error
                                ? reason.message
                                : 'The task could not be duplicated.'
                            );
                          });
                        }}
                        onDelete={() => {
                          void deleteTask(task).catch((reason: unknown) => {
                            setTaskActionError(
                              reason instanceof Error
                                ? reason.message
                                : 'The task could not be deleted.'
                            );
                          });
                        }}
                        actionPending={pendingTaskActionId === task.id}
                      />
                    ) : null;
                  }
                  const workflowStep = filteredWorkflowStepsById.get(item.id);
                  return workflowStep ? (
                    <WorkflowWorkRow
                      key={workflowStep.id}
                      rank={index + 1}
                      rankReason={reason}
                      item={workflowStep}
                      onComplete={() => {
                        void onCompleteWorkflowWorkItem(workflowStep);
                      }}
                      onOpen={() => {
                        onOpenWorkflowWorkItem(workflowStep);
                      }}
                    />
                  ) : null;
                })}
              </ol>
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
      <ConfirmDialog
        {...confirmDialogProps}
        data-testid="crm-task-delete-confirmation"
      />
    </Screen>
  );
}

export function TasksSurface() {
  const {
    adapter,
    addRequest,
    navigate,
    openWorkflowWorkItem,
    onAddRequestConsumed,
  } = useCrmHomeSurfaceContext();
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
      onOpenWorkflowWorkItem={(item) => {
        if (openWorkflowWorkItem) openWorkflowWorkItem(item);
        else navigate('workflows');
      }}
      onSaveView={(view) => adapter.actions.saveTaskView?.(view)}
      {...(addRequest ? { addRequest } : {})}
      {...(onAddRequestConsumed ? { onAddRequestConsumed } : {})}
    />
  );
}

function TaskRow({
  task,
  rank,
  rankReason,
  onComplete,
  onOpen,
  onDuplicate,
  onDelete,
  actionPending,
}: {
  task: CrmTask;
  rank: number;
  rankReason: string;
  onComplete: () => void;
  onOpen: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  actionPending: boolean;
}) {
  const { t } = useTranslation();
  return (
    <li
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
      <span
        aria-label={t('crmTasks.workList.rank.position', { rank })}
        data-testid={`crm-task-rank-${task.id}`}
        style={{ color: 'var(--kp-text-dim)', fontSize: 12, fontWeight: 800 }}
      >
        {String(rank)}
      </span>
      <button
        data-testid={`crm-task-complete-${task.id}`}
        aria-label={`Complete ${task.title}`}
        onClick={onComplete}
      >
        {task.status === 'done' ? '✓' : '□'}
      </button>
      <button
        data-testid={`crm-task-open-${task.id}`}
        aria-label={t('crmTasks.workList.openTask', {
          title: task.title,
          reason: rankReason,
        })}
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
        <span
          style={{
            ...mutedStyle,
            alignItems: 'center',
            display: 'flex',
            flexWrap: 'wrap',
            gap: 6,
            marginTop: 5,
          }}
        >
          <WorkKindBadge kind="task" testId={`crm-task-kind-${task.id}`} />
          <span>{task.householdLabel ?? t('crmTasks.workList.noClient')}</span>
          <PriorityBadge
            priority={task.priority}
            testId={`crm-task-priority-label-${task.id}`}
          />
          <span data-testid={`crm-task-due-${task.id}`}>
            {task.dueLabel ?? task.dueAt ?? t('crmTasks.workList.due.none')}
          </span>
          <span data-testid={`crm-task-assignee-label-${task.id}`}>
            {task.assigneeLabel ?? task.assigneeUserId ?? 'Unassigned'}
          </span>
          {task.recurrence && (
            <span data-testid={`crm-task-recurrence-label-${task.id}`}>
              Recurring
            </span>
          )}
        </span>
        <span
          data-testid={`crm-task-rank-reason-${task.id}`}
          style={{ ...mutedStyle, display: 'block', marginTop: 5 }}
        >
          {rankReason}
        </span>
      </button>
      <div
        role="group"
        aria-label={`Actions for ${task.title}`}
        style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}
      >
        <Button
          size="sm"
          variant="secondary"
          data-testid={`crm-task-edit-${task.id}`}
          aria-label={`Edit ${task.title}`}
          disabled={actionPending}
          onClick={onOpen}
        >
          Edit
        </Button>
        <Button
          size="sm"
          variant="secondary"
          data-testid={`crm-task-duplicate-${task.id}`}
          aria-label={`Duplicate ${task.title}`}
          disabled={actionPending}
          onClick={onDuplicate}
        >
          Duplicate
        </Button>
        <Button
          size="sm"
          variant="danger"
          data-testid={`crm-task-delete-${task.id}`}
          aria-label={`Delete ${task.title}`}
          disabled={actionPending}
          onClick={onDelete}
        >
          Delete
        </Button>
      </div>
    </li>
  );
}

function WorkflowWorkRow({
  item,
  rank,
  rankReason,
  onComplete,
  onOpen,
}: {
  item: CrmWorkflowWorkItem;
  rank: number;
  rankReason: string;
  onComplete: () => void;
  onOpen: () => void;
}) {
  const { t } = useTranslation();
  return (
    <li
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
      <span
        aria-label={t('crmTasks.workList.rank.position', { rank })}
        data-testid={`crm-workflow-work-rank-${item.id}`}
        style={{ color: 'var(--kp-text-dim)', fontSize: 12, fontWeight: 800 }}
      >
        {String(rank)}
      </span>
      <button
        data-testid={`crm-workflow-work-complete-${item.id}`}
        aria-label={`Complete ${item.title}`}
        onClick={onComplete}
      >
        □
      </button>
      <button
        aria-label={t('crmTasks.workList.openWorkflowStep', {
          workflow: item.workflowLabel,
          title: item.title,
          reason: rankReason,
        })}
        data-testid={`crm-workflow-work-open-${item.id}`}
        onClick={onOpen}
        style={{
          background: 'transparent',
          border: 0,
          cursor: 'pointer',
          flex: 1,
          textAlign: 'left',
        }}
      >
        <strong>{item.title}</strong>
        <span
          style={{
            ...mutedStyle,
            alignItems: 'center',
            display: 'flex',
            flexWrap: 'wrap',
            gap: 6,
            marginTop: 5,
          }}
        >
          <WorkKindBadge
            kind="workflow_step"
            testId={`crm-workflow-work-kind-${item.id}`}
          />
          <span data-testid={`crm-workflow-work-context-${item.id}`}>
            {t('crmTasks.workList.workflowContext', {
              workflow: item.workflowLabel,
            })}
          </span>
          <span>{item.householdLabel}</span>
          <PriorityBadge
            priority={item.priority}
            testId={`crm-workflow-work-priority-label-${item.id}`}
          />
          <span data-testid={`crm-workflow-work-due-${item.id}`}>
            {item.dueAt ?? t('crmTasks.workList.due.none')}
          </span>
          <span>
            {item.assigneeLabel ??
              item.assigneeUserId ??
              t('crmTasks.workList.unassigned')}
          </span>
        </span>
        <span
          data-testid={`crm-workflow-work-rank-reason-${item.id}`}
          style={{ ...mutedStyle, display: 'block', marginTop: 5 }}
        >
          {rankReason}
        </span>
      </button>
    </li>
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
  const { t } = useTranslation();
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
                aria-label={`Task priority: ${priorityLabel(draft.priority, t)}`}
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
