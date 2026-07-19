import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CrmTask, CrmWorkflowWorkItem } from '@/features/crm-home';
import type {
  TaskActionContext,
  TaskRecord,
  TaskRecordStore,
} from '@/features/crm-tasks';

const actionMount = vi.hoisted(() => ({
  context: undefined as TaskActionContext | undefined,
}));
const canonicalTaskStore = vi.hoisted(() => ({
  get: vi.fn<TaskRecordStore['get']>(),
  create: vi.fn<TaskRecordStore['create']>(),
  update: vi.fn<TaskRecordStore['update']>(),
  remove: vi.fn<TaskRecordStore['remove']>(),
}));

vi.mock('@/features/crm-tasks', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/crm-tasks')>()),
  useTaskRecordStore: () => canonicalTaskStore,
}));

vi.mock('./taskExtensionRegistry', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('./taskExtensionRegistry')>();
  return {
    ...actual,
    mountTaskActions: (context: TaskActionContext) => {
      actionMount.context = context;
      return actual.mountTaskActions(context);
    },
  };
});

import { Tasks } from './Tasks';

const task: CrmTask = {
  id: 'task-1',
  title: 'Review plan',
  assigneeUserId: null,
  status: 'open',
  priority: 'normal',
  body: 'Use the signed plan.',
  householdId: 'household-1',
  householdLabel: 'Morgan household',
  dueAt: '2026-08-03',
  dueLabel: '2026-08-03',
  dueTime: '09:30',
  category: 'Annual review',
  tagIds: ['tag:task'],
  recurrence: {
    freq: 'yearly',
    interval: 1,
    regenerateOnComplete: true,
  },
};

const canonicalSource: TaskRecord = {
  id: task.id,
  title: task.title,
  body: task.body ?? '',
  householdRef: {
    kind: 'household',
    id: 'household-1',
    matterId: 'matter-1',
    label: 'Morgan household',
  },
  assigneeUserId: null,
  status: 'done',
  due: '2026-08-03',
  dueTime: '09:30',
  recurrence: {
    freq: 'yearly',
    interval: 1,
    regenerateOnComplete: true,
  },
  priority: task.priority,
  category: 'Annual review',
  tagIds: task.tagIds,
  contextRefs: [
    {
      kind: 'document',
      id: 'Clients/Morgan/plan.docx',
      matterId: 'matter-1',
      label: 'Signed plan',
    },
  ],
};

const workflowWorkItem: CrmWorkflowWorkItem = {
  id: 'workflow-work-1',
  instanceId: 'workflow-instance-1',
  stepId: 'workflow-step-1',
  title: 'Prepare workflow review',
  workflowLabel: 'Annual client review',
  householdId: 'household-1',
  householdLabel: 'Morgan household',
  assigneeUserId: null,
  status: 'open',
  priority: 'normal',
  tagIds: ['tag:workflow'],
};

describe('task action context', () => {
  beforeEach(() => {
    actionMount.context = undefined;
    canonicalTaskStore.get.mockReset();
    canonicalTaskStore.create.mockReset();
    canonicalTaskStore.update.mockReset();
    canonicalTaskStore.remove.mockReset();
    canonicalTaskStore.get.mockResolvedValue(canonicalSource);
    canonicalTaskStore.create.mockImplementation((input) =>
      Promise.resolve({
        ...canonicalSource,
        ...input,
        id: 'task-duplicate',
        body: input.body ?? '',
        householdRef: input.householdRef ?? null,
        assigneeUserId: input.assigneeUserId ?? null,
        status: input.status ?? 'open',
        priority: input.priority ?? 'normal',
        tagIds: input.tagIds ?? [],
        contextRefs: input.contextRefs ?? [],
      })
    );
    canonicalTaskStore.remove.mockResolvedValue(undefined);
  });

  it('receives the canonical task and workflow-work inputs', () => {
    const tasks = [task] as const;
    const workflowWorkItems = [workflowWorkItem] as const;

    render(
      <Tasks
        tasks={tasks}
        workflowWorkItems={workflowWorkItems}
        firmMembers={[]}
        households={[]}
        savedViews={[]}
        freshness={{ kind: 'live' }}
        onUpdateTask={vi.fn()}
        onCompleteWorkflowWorkItem={vi.fn()}
        onOpenWorkflowWorkItem={vi.fn()}
        onSaveView={vi.fn()}
      />
    );

    expect(actionMount.context?.tasks).toBe(tasks);
    expect(actionMount.context?.workflowWorkItems).toBe(workflowWorkItems);
  });

  it('gives ordinary rows keyboard-ready Edit, Duplicate, and Delete controls while workflow work stays separate', () => {
    renderTasks();

    const actions = screen.getByRole('group', {
      name: 'Actions for Review plan',
    });
    expect(
      within(actions).getByRole('button', { name: 'Edit Review plan' })
    ).toHaveTextContent('Edit');
    expect(
      within(actions).getByRole('button', { name: 'Duplicate Review plan' })
    ).toHaveTextContent('Duplicate');
    expect(
      within(actions).getByRole('button', { name: 'Delete Review plan' })
    ).toHaveTextContent('Delete');
    expect(
      within(
        screen.getByTestId('crm-workflow-work-workflow-work-1')
      ).queryByRole('group')
    ).not.toBeInTheDocument();

    const edit = within(actions).getByRole('button', {
      name: 'Edit Review plan',
    });
    edit.focus();
    expect(edit).toHaveFocus();
    fireEvent.click(edit);
    expect(
      screen.getByRole('complementary', { name: 'Task detail' })
    ).toBeInTheDocument();
  });

  it('duplicates the full canonical source with a fresh open identity and opens the real editor', async () => {
    const sourceBefore = structuredClone(canonicalSource);
    renderTasks();

    fireEvent.click(
      screen.getByRole('button', { name: 'Duplicate Review plan' })
    );

    await waitFor(() => {
      expect(canonicalTaskStore.create).toHaveBeenCalledWith({
        title: 'Review plan',
        body: 'Use the signed plan.',
        householdRef: canonicalSource.householdRef,
        assigneeUserId: null,
        status: 'open',
        due: '2026-08-03',
        dueTime: '09:30',
        recurrence: canonicalSource.recurrence,
        priority: 'normal',
        category: 'Annual review',
        tagIds: ['tag:task'],
        contextRefs: canonicalSource.contextRefs,
      });
    });
    expect(canonicalSource).toEqual(sourceBefore);
    expect(canonicalTaskStore.get).toHaveBeenCalledWith('task-1');
    expect(screen.getByTestId('crm-task-title-input')).toHaveValue(
      'Review plan'
    );
    expect(screen.getByTestId('crm-task-status')).toHaveValue('open');
  });

  it('leaves the task untouched when deletion is rejected and removes only after confirmation', async () => {
    renderTasks();

    fireEvent.click(screen.getByRole('button', { name: 'Delete Review plan' }));
    const confirmation = await screen.findByTestId(
      'crm-task-delete-confirmation'
    );
    expect(confirmation).toHaveTextContent(
      'The task will move to Trash, where it can be restored for 30 days.'
    );
    fireEvent.click(
      within(confirmation).getByRole('button', { name: 'Cancel' })
    );
    expect(canonicalTaskStore.remove).not.toHaveBeenCalled();
    expect(screen.getByTestId('crm-task-record-task-1')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Delete Review plan' }));
    fireEvent.click(
      within(
        await screen.findByTestId('crm-task-delete-confirmation')
      ).getByRole('button', { name: 'Delete' })
    );
    await waitFor(() => {
      expect(canonicalTaskStore.remove).toHaveBeenCalledOnce();
      expect(canonicalTaskStore.remove).toHaveBeenCalledWith('task-1');
    });
  });
});

function renderTasks() {
  return render(
    <Tasks
      tasks={[task]}
      workflowWorkItems={[workflowWorkItem]}
      firmMembers={[]}
      households={[{ id: 'household-1', name: 'Morgan household' }]}
      savedViews={[]}
      freshness={{ kind: 'live' }}
      onUpdateTask={vi.fn()}
      onCompleteWorkflowWorkItem={vi.fn()}
      onOpenWorkflowWorkItem={vi.fn()}
      onSaveView={vi.fn()}
    />
  );
}
