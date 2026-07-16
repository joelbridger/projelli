import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CrmTask, CrmWorkflowWorkItem } from '@/features/crm-home';
import type { TaskActionContext } from '@/features/crm-tasks';

const actionMount = vi.hoisted(() => ({
  context: undefined as TaskActionContext | undefined,
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
  tagIds: ['tag:task'],
};

const workflowWorkItem: CrmWorkflowWorkItem = {
  id: 'workflow-work-1',
  instanceId: 'workflow-instance-1',
  stepId: 'workflow-step-1',
  title: 'Prepare workflow review',
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
        onSaveView={vi.fn()}
      />
    );

    expect(actionMount.context?.tasks).toBe(tasks);
    expect(actionMount.context?.workflowWorkItems).toBe(workflowWorkItems);
  });
});
