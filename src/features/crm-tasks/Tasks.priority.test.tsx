import {
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CrmTask } from '@/features/crm-home/types';
import type { LiveCrmRecord } from '@/platform/crm/liveRecords';

const canonical = vi.hoisted(() => ({
  records: [] as LiveCrmRecord[],
  save: vi.fn<(record: LiveCrmRecord) => Promise<LiveCrmRecord>>(),
  reload: vi.fn<() => Promise<void>>(),
}));

vi.mock('@/platform/crm/useLiveCrmRecords', () => ({
  useLiveCrmRecords: () => ({
    records: canonical.records,
    save: canonical.save,
    reload: canonical.reload,
    workspaceRoot: '/workspace',
    error: null,
  }),
}));

import { useTaskRecordStore } from './taskRecordStore';
import { Tasks } from './Tasks';

function task(id: string, priority: CrmTask['priority']): CrmTask {
  return {
    id,
    title: `${priority[0]?.toUpperCase() ?? ''}${priority.slice(1)} task`,
    assigneeUserId: null,
    status: 'open',
    priority,
    tagIds: [],
  };
}

function renderTasks(
  tasks: readonly CrmTask[],
  onUpdateTask: (updated: CrmTask) => void | Promise<void> = vi.fn()
) {
  return render(
    <Tasks
      tasks={tasks}
      workflowWorkItems={[]}
      firmMembers={[]}
      households={[]}
      savedViews={[]}
      freshness={{ kind: 'live' }}
      onUpdateTask={onUpdateTask}
      onCompleteWorkflowWorkItem={vi.fn()}
      onSaveView={vi.fn()}
    />
  );
}

describe('task priority urgency', () => {
  beforeEach(() => {
    canonical.records = [];
    canonical.save.mockReset();
    canonical.reload.mockReset();
    canonical.save.mockImplementation((record) => {
      const saved = structuredClone(record);
      canonical.records = canonical.records.some(
        (candidate) => candidate.id === saved.id
      )
        ? canonical.records.map((candidate) =>
            candidate.id === saved.id ? saved : candidate
          )
        : [...canonical.records, saved];
      return Promise.resolve(structuredClone(saved));
    });
    canonical.reload.mockResolvedValue(undefined);
  });

  it('shows readable words and distinct shapes for every priority in the task list', () => {
    renderTasks([
      task('task-high', 'high'),
      task('task-normal', 'normal'),
      task('task-low', 'low'),
    ]);

    const high = screen.getByTestId('crm-task-priority-label-task-high');
    const normal = screen.getByTestId('crm-task-priority-label-task-normal');
    const low = screen.getByTestId('crm-task-priority-label-task-low');

    expect(high).toHaveAccessibleName('High priority');
    expect(high).toHaveTextContent('▲High priority');
    expect(normal).toHaveAccessibleName('Normal priority');
    expect(normal).toHaveTextContent('◆Normal priority');
    expect(low).toHaveAccessibleName('Low priority');
    expect(low).toHaveTextContent('▼Low priority');
    expect(
      screen.getByRole('button', { name: /High task.*High priority/i })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Normal task.*Normal priority/i })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Low task.*Low priority/i })
    ).toBeInTheDocument();
  });

  it('keeps the normal legacy default and round-trips a keyboard priority edit through the canonical store', async () => {
    canonical.records = [
      {
        id: 'task-legacy',
        kind: 'task',
        matterId: 'firm_home',
        title: 'Legacy review',
        body: '',
        assigneeUserId: null,
        status: 'open',
        tagIds: [],
        contextRefs: [],
      },
    ];
    const writer = renderHook(() => useTaskRecordStore());
    const legacy = await writer.result.current.get('task-legacy');
    expect(legacy?.priority).toBe('normal');

    const displayed: CrmTask = {
      id: 'task-legacy',
      title: legacy?.title ?? 'Legacy review',
      assigneeUserId: null,
      status: 'open',
      priority: legacy?.priority ?? 'normal',
      tagIds: [],
    };
    const updateTask = vi.fn(async (updated: CrmTask) => {
      await writer.result.current.update(updated.id, {
        priority: updated.priority,
      });
    });
    renderTasks([displayed], updateTask);

    expect(
      screen.getByTestId('crm-task-priority-label-task-legacy')
    ).toHaveAccessibleName('Normal priority');
    fireEvent.click(screen.getByTestId('crm-task-open-task-legacy'));

    const detail = screen.getByTestId('crm-task-detail');
    const select = within(detail).getByRole('combobox', {
      name: 'Task priority: Normal priority',
    });
    select.focus();
    expect(select).toHaveFocus();
    fireEvent.change(select, { target: { value: 'high' } });

    expect(select).toHaveAccessibleName('Task priority: High priority');
    expect(
      screen.getByRole('status', { name: 'High priority' })
    ).toHaveTextContent('▲High priority');
    fireEvent.click(screen.getByTestId('crm-task-save'));

    await waitFor(() => {
      expect(updateTask).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'task-legacy', priority: 'high' })
      );
      expect(canonical.save).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'task-legacy', priority: 'high' })
      );
      expect(canonical.reload).toHaveBeenCalledOnce();
    });
    writer.unmount();

    const freshReader = renderHook(() => useTaskRecordStore());
    await expect(
      freshReader.result.current.get('task-legacy')
    ).resolves.toMatchObject({ priority: 'high' });
    freshReader.unmount();
  });
});
