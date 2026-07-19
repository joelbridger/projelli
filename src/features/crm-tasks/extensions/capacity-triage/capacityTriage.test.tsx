import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setDevFlagOverride } from '@/platform/flags';
import { buildCapacityTriage } from './index';
import { CapacityTriageAction } from './CapacityTriageAction';
import {
  mountTaskActions,
  taskActionRegistry,
} from '../../taskExtensionRegistry';

const tagStore = vi.hoisted(() => ({
  catalog: {
    version: 1 as const,
    tags: [
      {
        id: 'tag:review',
        name: 'Review',
        color: '#2563eb' as const,
        status: 'active' as const,
      },
      {
        id: 'tag:legacy',
        name: 'Legacy',
        color: '#475569' as const,
        status: 'retired' as const,
      },
    ],
  },
  errorCode: null,
  list: vi.fn(),
}));

vi.mock('@/features/crm-tags', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/crm-tags')>();
  return {
    ...actual,
    useFirmTagStore: vi.fn(() => tagStore),
  };
});

const tasks = [
  {
    id: 'task-urgent',
    title: 'Urgent review',
    assigneeUserId: 'advisor-1',
    status: 'open' as const,
    priority: 'high' as const,
    dueAt: '2030-01-01',
    tagIds: ['tag:review'],
  },
  {
    id: 'task-unscheduled',
    title: 'Unscheduled work',
    assigneeUserId: null,
    status: 'open' as const,
    priority: 'normal' as const,
    tagIds: ['tag:legacy'],
  },
];

const workflowWorkItems = [
  {
    id: 'workflow-prepare',
    instanceId: 'workflow-1',
    stepId: 'prepare',
    title: 'Prepare packet',
    workflowLabel: 'Annual client review',
    householdId: 'household-1',
    householdLabel: 'Morgan household',
    assigneeUserId: 'advisor-2',
    status: 'in_progress' as const,
    priority: 'normal' as const,
    dueAt: '2030-01-01',
    tagIds: ['tag:review'],
  },
];

afterEach(() => {
  setDevFlagOverride('task-capacity-triage', undefined);
  tagStore.list.mockReset();
  tagStore.list.mockResolvedValue(tagStore.catalog);
});

describe('capacity triage', () => {
  it('filters stable tag IDs and ranks current task and workflow work deterministically', () => {
    const result = buildCapacityTriage({
      tasks,
      workflowWorkItems,
      preference: {
        assignee: 'all',
        duePressure: 'all',
        priority: 'all',
        tagIds: ['tag:review'],
      },
      today: '2030-01-01',
    });

    expect(result.ranked.map((item) => item.id)).toEqual([
      'task-urgent',
      'workflow-prepare',
    ]);
    expect(result.ranked[0]).toBe(tasks[0]);
    expect(result.ranked[1]).toBe(workflowWorkItems[0]);
    expect(result).toMatchObject({
      openCount: 3,
      shownCount: 2,
      unscheduledCount: 1,
      unassignedCount: 1,
    });
  });

  it('reports missing schedule and assignment data without inventing capacity facts', () => {
    const unscheduledTask = tasks.find(
      (task) => task.id === 'task-unscheduled'
    );
    if (!unscheduledTask) {
      throw new Error('Expected the unscheduled task fixture.');
    }
    const result = buildCapacityTriage({
      tasks: [unscheduledTask],
      workflowWorkItems: [],
      preference: {
        assignee: 'all',
        duePressure: 'all',
        priority: 'all',
        tagIds: [],
      },
      today: '2030-01-01',
    });

    expect(result).toEqual({
      openCount: 1,
      shownCount: 1,
      unscheduledCount: 1,
      unassignedCount: 1,
      ranked: [expect.objectContaining({ id: 'task-unscheduled' })],
    });
    expect('capacity' in result).toBe(false);
  });

  it('does not read tags or leave a toolbar gap while the flag is off', () => {
    const { container } = render(
      <CapacityTriageAction
        tasks={tasks}
        workflowWorkItems={workflowWorkItems}
        compatibilityMount={null}
      />
    );

    expect(container).toBeEmptyDOMElement();
    expect(tagStore.list).not.toHaveBeenCalled();
  });

  it('registers and mounts the enabled toolbar descriptor through the task registry', async () => {
    setDevFlagOverride('task-capacity-triage', true);
    render(
      <>
        {mountTaskActions({
          tasks,
          workflowWorkItems,
          compatibilityMount: null,
        })}
      </>
    );

    expect(taskActionRegistry.map((descriptor) => descriptor.id)).toContain(
      'capacity-triage.toolbar'
    );
    expect(
      screen.getByTestId('crm-task-capacity-triage-toggle')
    ).toBeInTheDocument();
    screen.getByTestId('crm-task-capacity-triage-toggle').click();
    await waitFor(() => {
      expect(tagStore.list).toHaveBeenCalledOnce();
    });
    expect(
      screen.getByTestId('crm-task-capacity-triage-tag-tag:legacy')
    ).toHaveTextContent('Retired');
  });
});
