import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CrmTask } from '@/features/crm-home/types';
import type { LiveCrmRecord } from '@/platform/crm/liveRecords';

const canonical = vi.hoisted(() => ({
  records: [] as LiveCrmRecord[],
  commands: [] as string[],
  invoke:
    vi.fn<
      (
        command: string,
        args?: { record?: LiveCrmRecord }
      ) => Promise<unknown>
    >(),
}));

vi.mock('@tauri-apps/api/core', () => ({
  isTauri: () => true,
  invoke: (command: string, args?: { record?: LiveCrmRecord }) =>
    canonical.invoke(command, args),
}));
vi.mock('@/platform/utils/wealthbox-commands', () => ({
  crmSetWorkspace: () => Promise.resolve(),
}));
vi.mock('@/platform/fs/workspaceStore', () => ({
  useWorkspaceStore: <T,>(selector: (state: { rootPath: string }) => T) =>
    selector({ rootPath: '/workspace' }),
}));
vi.mock('@/platform/client-context', () => ({
  useSelectionOperationDecision: () => ({ kind: 'all-matters', client: null }),
  readSelectionOperationDecision: () => ({ kind: 'all-matters', client: null }),
}));
vi.mock('@/platform/matter/matterStore', () => ({
  useMatterStore: <T,>(
    selector: (state: { matters: []; activeMatterId: null }) => T
  ) => selector({ matters: [], activeMatterId: null }),
}));
vi.mock('@/platform/crm/store', () => ({
  getCrmEngineFreshness: () => ({ kind: 'idle' }),
  subscribeCrmEngineFreshness: () => () => undefined,
}));
vi.mock('@/platform/crm/liveRecordRelay', () => ({
  clearLiveRecordRelay: vi.fn(),
  ensureLiveRecordRelay: vi.fn(() => Promise.resolve(null)),
  removeLiveRecordRelayWriter: vi.fn(),
  publishLiveRecord: vi.fn(),
}));

import { CrmHome } from '@/features/crm-home/CrmHome';
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
      onOpenWorkflowWorkItem={vi.fn()}
      onSaveView={vi.fn()}
    />
  );
}

describe('task priority urgency', () => {
  beforeEach(() => {
    canonical.records = [];
    canonical.commands = [];
    canonical.invoke.mockReset();
    canonical.invoke.mockImplementation((command, args) => {
      canonical.commands.push(command);
      if (command === 'crm_live_list') {
        return Promise.resolve(structuredClone(canonical.records));
      }
      if (command === 'crm_live_upsert' && args?.record) {
        const saved = structuredClone(args.record);
        canonical.records = canonical.records.some(
          (candidate) => candidate.id === saved.id
        )
          ? canonical.records.map((candidate) =>
              candidate.id === saved.id ? saved : candidate
            )
          : [...canonical.records, saved];
        return Promise.resolve(structuredClone(saved));
      }
      return Promise.reject(new Error(`Unexpected command ${command}`));
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
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

  it('keeps the saved marker visible when a draft priority edit is cancelled', () => {
    renderTasks([task('task-cancelled', 'normal')]);

    fireEvent.click(screen.getByTestId('crm-task-open-task-cancelled'));
    const detail = screen.getByTestId('crm-task-detail');
    const select = within(detail).getByRole('combobox', {
      name: 'Task priority: Normal priority',
    });
    fireEvent.change(select, { target: { value: 'high' } });

    expect(select).toHaveAccessibleName('Task priority: High priority');
    expect(
      within(detail).getByRole('status', { name: 'Normal priority' })
    ).toHaveTextContent('◆Normal priority');
    fireEvent.click(within(detail).getByRole('button', { name: 'Close' }));
    expect(
      screen.getByTestId('crm-task-priority-label-task-cancelled')
    ).toHaveAccessibleName('Normal priority');
  });

  it('keeps the normal legacy default and round-trips a keyboard priority edit through the live Tasks adapter and canonical reload', async () => {
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
    const mounted = render(<CrmHome initialRoute="tasks" />);

    expect(
      await screen.findByTestId('crm-task-priority-label-task-legacy')
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
      within(detail).getByRole('status', { name: 'Normal priority' })
    ).toHaveTextContent('◆Normal priority');
    fireEvent.click(screen.getByTestId('crm-task-save'));

    await waitFor(() => {
      expect(
        canonical.records.find((record) => record.id === 'task-legacy')
      ).toMatchObject({ kind: 'task', priority: 'high' });
      expect(screen.queryByTestId('crm-task-detail')).not.toBeInTheDocument();
    });
    const taskUpsert = canonical.invoke.mock.calls.findIndex(
      ([command, args]) =>
        command === 'crm_live_upsert' && args?.record?.id === 'task-legacy'
    );
    expect(taskUpsert).toBeGreaterThanOrEqual(0);
    expect(
      canonical.commands.slice(taskUpsert + 1)
    ).toContain('crm_live_list');
    mounted.unmount();

    const loadsBeforeReopen = canonical.commands.filter(
      (command) => command === 'crm_live_list'
    ).length;
    render(<CrmHome initialRoute="tasks" />);
    expect(
      await screen.findByTestId('crm-task-priority-label-task-legacy')
    ).toHaveAccessibleName('High priority');
    expect(
      canonical.commands.filter((command) => command === 'crm_live_list')
        .length
    ).toBeGreaterThan(loadsBeforeReopen);
  });
});
