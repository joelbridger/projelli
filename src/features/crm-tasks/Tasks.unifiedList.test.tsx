import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { CrmTask, CrmWorkflowWorkItem } from '@/features/crm-home/types';

vi.mock('@/features/crm-tasks', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/crm-tasks')>()),
  useTaskRecordStore: () => ({
    get: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
  }),
}));

import { Tasks } from './Tasks';

function task(
  id: string,
  title: string,
  overrides: Partial<CrmTask> = {}
): CrmTask {
  return {
    id,
    title,
    assigneeUserId: null,
    status: 'open',
    priority: 'normal',
    tagIds: [],
    ...overrides,
  };
}

function workflowStep(
  id: string,
  title: string,
  overrides: Partial<CrmWorkflowWorkItem> = {}
): CrmWorkflowWorkItem {
  return {
    id,
    instanceId: `instance-${id}`,
    stepId: `step-${id}`,
    title,
    householdId: 'household-1',
    householdLabel: 'Morgan household',
    assigneeUserId: null,
    status: 'open',
    priority: 'normal',
    tagIds: [],
    ...overrides,
  };
}

function renderTasks({
  tasks,
  workflowWorkItems,
  onUpdateTask = vi.fn(),
  onCompleteWorkflowWorkItem = vi.fn(),
}: {
  tasks: readonly CrmTask[];
  workflowWorkItems: readonly CrmWorkflowWorkItem[];
  onUpdateTask?: (updated: CrmTask) => void | Promise<void>;
  onCompleteWorkflowWorkItem?: (
    item: CrmWorkflowWorkItem
  ) => void | Promise<void>;
}) {
  render(
    <Tasks
      tasks={tasks}
      workflowWorkItems={workflowWorkItems}
      firmMembers={[]}
      households={[]}
      savedViews={[]}
      freshness={{ kind: 'live' }}
      onUpdateTask={onUpdateTask}
      onCompleteWorkflowWorkItem={onCompleteWorkflowWorkItem}
      onSaveView={vi.fn()}
    />
  );
}

function visibleRowIds(): string[] {
  return within(screen.getByTestId('crm-task-list'))
    .getAllByTestId(/^crm-(?:task-record-|workflow-work-(?!complete-))/)
    .map((row) => row.getAttribute('data-testid') ?? '');
}

describe('unified daily work list', () => {
  it('mixes both kinds in the existing daily rank and leaves closed work last', () => {
    renderTasks({
      tasks: [
        task('later-task', 'Schedule follow-up', { dueAt: '2999-01-01' }),
        task('high-task', 'Call plan sponsor', { priority: 'high' }),
        task('done-task', 'Archive signed plan', {
          status: 'done',
          dueAt: '2000-01-01',
        }),
      ],
      workflowWorkItems: [
        workflowStep('due-step', 'Prepare annual review', {
          dueAt: '2000-01-01',
        }),
        workflowStep('blocked-step', 'Wait for signed form', {
          status: 'blocked',
          priority: 'high',
        }),
      ],
    });

    expect(visibleRowIds()).toEqual([
      'crm-workflow-work-due-step',
      'crm-task-record-later-task',
      'crm-task-record-high-task',
      'crm-workflow-work-blocked-step',
      'crm-task-record-done-task',
    ]);
    expect(screen.getByTestId('crm-workflow-work-due-step')).toHaveTextContent(
      'Workflow step'
    );
    expect(screen.getByTestId('crm-task-record-later-task')).toHaveTextContent(
      'Task'
    );
  });

  it('filters matching tasks and workflow steps into the same result list', () => {
    renderTasks({
      tasks: [
        task('matching-task', 'Review beneficiary task'),
        task('other-task', 'Call custodian'),
      ],
      workflowWorkItems: [
        workflowStep('matching-step', 'Review beneficiary workflow'),
        workflowStep('other-step', 'Prepare transfer form'),
      ],
    });

    fireEvent.change(
      screen.getByRole('textbox', {
        name: 'Search tasks',
      }),
      { target: { value: 'beneficiary' } }
    );

    expect(visibleRowIds()).toEqual([
      'crm-task-record-matching-task',
      'crm-workflow-work-matching-step',
    ]);
    expect(screen.queryByText('Call custodian')).not.toBeInTheDocument();
    expect(screen.queryByText('Prepare transfer form')).not.toBeInTheDocument();
  });

  it('keeps task and workflow completion on their separate canonical routes', () => {
    const ordinaryTask = task('ordinary', 'Review policy');
    const step = workflowStep('workflow', 'Complete compliance check');
    const onUpdateTask = vi.fn();
    const onCompleteWorkflowWorkItem = vi.fn();
    renderTasks({
      tasks: [ordinaryTask],
      workflowWorkItems: [step],
      onUpdateTask,
      onCompleteWorkflowWorkItem,
    });

    fireEvent.click(
      screen.getByRole('button', { name: 'Complete Review policy' })
    );
    expect(onUpdateTask).toHaveBeenCalledOnce();
    expect(onUpdateTask).toHaveBeenCalledWith({
      ...ordinaryTask,
      status: 'done',
    });
    expect(onCompleteWorkflowWorkItem).not.toHaveBeenCalled();

    onUpdateTask.mockClear();
    fireEvent.click(screen.getByTestId('crm-workflow-work-complete-workflow'));
    expect(onCompleteWorkflowWorkItem).toHaveBeenCalledOnce();
    expect(onCompleteWorkflowWorkItem).toHaveBeenCalledWith(step);
    expect(onUpdateTask).not.toHaveBeenCalled();
  });
});
