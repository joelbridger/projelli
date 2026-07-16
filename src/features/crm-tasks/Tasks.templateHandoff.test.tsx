import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CrmHouseholdAddRequest } from '@/features/crm-home/routes';
import type { CrmTask } from '@/features/crm-home/types';
import { Tasks } from './Tasks';

let templatesEnabled = false;
const taskCreate = vi.fn();
const templateList = vi.fn();
const templateApply = vi.fn();
const recordSnapshot: readonly unknown[] = [];

vi.mock('@/platform/flags', () => ({ useFlag: () => templatesEnabled }));
vi.mock('@/features/crm-tags', () => ({
  useFirmTagStore: () => ({ list: vi.fn().mockResolvedValue({ version: 1, tags: [] }) }),
}));
vi.mock('@/features/crm-tasks', () => ({
  useTaskRecordStore: () => ({ create: taskCreate }),
}));
vi.mock('./extensions/templates/taskTemplateStore', () => ({
  useTaskTemplateStore: () => ({
    recordSnapshot,
    list: templateList,
    create: vi.fn(),
    update: vi.fn(),
    retire: vi.fn(),
    apply: templateApply,
  }),
}));

const request: CrmHouseholdAddRequest = {
  kind: 'task',
  householdId: 'household:review',
  householdLabel: 'Review household',
};

const createdTask = {
  id: 'task:from-template',
  title: 'Review the plan',
  body: '',
  householdRef: null,
  assigneeUserId: null,
  status: 'open',
  priority: 'normal',
  tagIds: [],
  contextRefs: [],
};

const template = {
  id: 'task-template:review',
  name: 'Review',
  title: 'Review the plan',
  body: '',
  priority: 'normal' as const,
  category: null,
  due: null,
  dueTime: null,
  relationPrompt: null,
  tagIds: [],
  retired: false,
};

function HandoffHarness({ onConsumed, onUpdateTask, tasks = [] }: { onConsumed: () => void; onUpdateTask?: (task: CrmTask) => Promise<void>; tasks?: readonly CrmTask[] }) {
  const [addRequest, setAddRequest] = useState<CrmHouseholdAddRequest | null>(request);
  return <Tasks
    tasks={tasks}
    workflowWorkItems={[]}
    firmMembers={[]}
    households={[{ id: request.householdId, name: request.householdLabel }]}
    savedViews={[]}
    freshness={{ kind: 'idle' }}
    onUpdateTask={onUpdateTask ?? vi.fn()}
    onCompleteWorkflowWorkItem={vi.fn()}
    onSaveView={vi.fn()}
    {...(addRequest ? { addRequest } : {})}
    onAddRequestConsumed={() => { setAddRequest(null); onConsumed(); }}
  />;
}

describe('Tasks template household handoff', () => {
  beforeEach(() => {
    templatesEnabled = false;
    vi.clearAllMocks();
    templateList.mockResolvedValue([template]);
    templateApply.mockResolvedValue({
      template,
      taskInput: { title: template.title, body: '', priority: 'normal', tagIds: [] },
    });
    taskCreate.mockResolvedValue(createdTask);
  });

  it('passes the household request through the templates mount to the canonical task doorway', async () => {
    templatesEnabled = true;
    const consumed = vi.fn();
    render(<HandoffHarness onConsumed={consumed} />);

    fireEvent.click(screen.getByTestId('crm-task-template-library-open'));
    await screen.findByTestId('crm-task-template-task-template:review');
    fireEvent.click(screen.getByText('Use template'));

    await waitFor(() => {
      expect(taskCreate).toHaveBeenCalledWith({
        title: 'Review the plan',
        body: '',
        priority: 'normal',
        tagIds: [],
        householdRef: {
          kind: 'household',
          id: 'household:review',
          matterId: 'household:review',
          label: 'Review household',
        },
      });
    });
    expect(consumed).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('crm-task-detail')).not.toBeInTheDocument();
  });

  it('clears the request after saving, so a later new task does not inherit it', async () => {
    const consumed = vi.fn();
    render(<HandoffHarness onConsumed={consumed} onUpdateTask={vi.fn().mockResolvedValue(undefined)} />);

    fireEvent.change(screen.getByTestId('crm-task-title-input'), { target: { value: 'First task' } });
    fireEvent.click(screen.getByTestId('crm-task-save'));

    await waitFor(() => { expect(consumed).toHaveBeenCalledTimes(1); });
    fireEvent.click(screen.getByTestId('crm-task-new'));
    expect(within(screen.getByTestId('crm-task-detail')).getByTestId('crm-task-household')).toHaveValue('');
  });

  it('keeps a different open task editor when applying a household template', async () => {
    templatesEnabled = true;
    const existing: CrmTask = {
      id: 'task:existing',
      title: 'Keep my draft',
      assigneeUserId: null,
      status: 'open',
      priority: 'normal',
      tagIds: [],
    };
    render(<HandoffHarness onConsumed={vi.fn()} tasks={[existing]} />);

    fireEvent.click(within(screen.getByTestId('crm-task-detail')).getByText('Close'));
    fireEvent.click(screen.getByTestId(`crm-task-open-${existing.id}`));
    expect(screen.getByTestId('crm-task-title-input')).toHaveValue('Keep my draft');
    fireEvent.click(screen.getByTestId('crm-task-template-library-open'));
    await screen.findByTestId('crm-task-template-task-template:review');
    fireEvent.click(screen.getByText('Use template'));

    await waitFor(() => { expect(taskCreate).toHaveBeenCalledTimes(1); });
    expect(screen.getByTestId('crm-task-title-input')).toHaveValue('Keep my draft');
  });

  it('clears the request after closing, so a later new task does not inherit it', async () => {
    const consumed = vi.fn();
    render(<HandoffHarness onConsumed={consumed} />);

    fireEvent.click(within(screen.getByTestId('crm-task-detail')).getByText('Close'));

    await waitFor(() => { expect(consumed).toHaveBeenCalledTimes(1); });
    fireEvent.click(screen.getByTestId('crm-task-new'));
    expect(within(screen.getByTestId('crm-task-detail')).getByTestId('crm-task-household')).toHaveValue('');
  });
});
