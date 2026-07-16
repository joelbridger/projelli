 
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FirmTag } from '@/features/crm-tags';
import type { TaskRecord } from '@/features/crm-tasks';
import type { TaskTemplate } from './contract';
import { TaskTemplateLibrary } from './TaskTemplateLibrary';

let enabled = false;
const tagList = vi.fn();
const taskCreate = vi.fn();
const templateList = vi.fn();
const templateApply = vi.fn();
const templateUpdate = vi.fn();
const templateRetire = vi.fn();

vi.mock('@/platform/flags', () => ({ useFlag: () => enabled }));
vi.mock('@/features/crm-tags', () => ({ useFirmTagStore: () => ({ list: tagList }) }));
vi.mock('@/features/crm-tasks', () => ({ useTaskRecordStore: () => ({ create: taskCreate }) }));
vi.mock('./taskTemplateStore', () => ({
  useTaskTemplateStore: () => ({
    list: templateList,
    create: vi.fn(),
    update: templateUpdate,
    retire: templateRetire,
    apply: templateApply,
  }),
}));

const activeTag: FirmTag = { id: 'tag:active', name: 'Active', color: '#123456', status: 'active' };
const createdTask: TaskRecord = {
  id: 'task:created', title: 'Prepare review', body: '', householdRef: null,
  assigneeUserId: null, status: 'open', priority: 'normal', tagIds: ['tag:active'], contextRefs: [],
};
const template: TaskTemplate = {
  id: 'task-template:review', name: 'Review', title: 'Prepare review', body: '', priority: 'normal',
  category: null, relationPrompt: null, tagIds: ['tag:active'], retired: false,
};

describe('TaskTemplateLibrary', () => {
  beforeEach(() => {
    enabled = false;
    vi.clearAllMocks();
    tagList.mockResolvedValue({ version: 1, tags: [activeTag] });
    templateList.mockResolvedValue([template]);
    templateApply.mockResolvedValue({ template, taskInput: { title: template.title, body: '', priority: 'normal', tagIds: ['tag:active'] } });
    taskCreate.mockResolvedValue(createdTask);
  });

  it('is fully inert while its flag is off', () => {
    render(<TaskTemplateLibrary onCreate={vi.fn()} />);

    expect(tagList).not.toHaveBeenCalled();
    expect(templateList).not.toHaveBeenCalled();
    expect(taskCreate).not.toHaveBeenCalled();
    expect(screen.queryByTestId('crm-task-template-library-open')).not.toBeInTheDocument();
  });

  it('uses only active stable tag IDs when applying a template through the task doorway', async () => {
    enabled = true;
    const onCreate = vi.fn();
    render(<TaskTemplateLibrary onCreate={onCreate} />);
    fireEvent.click(screen.getByTestId('crm-task-template-library-open'));
    await screen.findByTestId('crm-task-template-task-template:review');
    fireEvent.click(screen.getByText('Use template'));

    await waitFor(() => { expect(taskCreate).toHaveBeenCalledWith({
      title: 'Prepare review', body: '', priority: 'normal', tagIds: ['tag:active'],
    }); });
    expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({ id: 'task:created', tagIds: ['tag:active'] }));
  });

  it('refuses an applied template whose tag has been retired', async () => {
    enabled = true;
    tagList.mockResolvedValue({ version: 1, tags: [{ ...activeTag, status: 'retired' }] });
    render(<TaskTemplateLibrary onCreate={vi.fn()} />);
    fireEvent.click(screen.getByTestId('crm-task-template-library-open'));
    await screen.findByTestId('crm-task-template-task-template:review');
    fireEvent.click(screen.getByText('Use template'));

    await screen.findByText('A retired tag cannot be used on a new task template.');
    expect(taskCreate).not.toHaveBeenCalled();
  });

  it('shows a template client prompt before creating the editable task', async () => {
    enabled = true;
    const prompted = { ...template, relationPrompt: 'Choose the review household.' };
    templateList.mockResolvedValue([prompted]);
    templateApply.mockResolvedValue({ template: prompted, taskInput: { title: prompted.title, body: '', priority: 'normal', tagIds: ['tag:active'] } });
    render(<TaskTemplateLibrary onCreate={vi.fn()} />);
    fireEvent.click(screen.getByTestId('crm-task-template-library-open'));
    await screen.findByTestId('crm-task-template-task-template:review');
    fireEvent.click(screen.getByText('Use template'));

    expect(await screen.findByText('Choose the review household.')).toBeInTheDocument();
    expect(taskCreate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Continue to task'));
    await waitFor(() => { expect(taskCreate).toHaveBeenCalledTimes(1); });
  });

  it('lets an existing template remove a tag that has since been retired', async () => {
    enabled = true;
    tagList.mockResolvedValue({ version: 1, tags: [{ ...activeTag, status: 'retired' }] });
    templateUpdate.mockResolvedValue({ ...template, tagIds: [] });
    render(<TaskTemplateLibrary onCreate={vi.fn()} />);
    fireEvent.click(screen.getByTestId('crm-task-template-library-open'));
    await screen.findByTestId('crm-task-template-task-template:review');
    fireEvent.click(screen.getByText('Edit'));
    fireEvent.click(screen.getByText('Remove Active'));
    fireEvent.click(screen.getByTestId('crm-task-template-save'));

    await waitFor(() => { expect(templateUpdate).toHaveBeenCalledWith(template.id, expect.objectContaining({ tagIds: [] })); });
  });

  it('keeps an optional household context and confirms before retiring', async () => {
    enabled = true;
    templateRetire.mockResolvedValue({ ...template, retired: true });
    render(<TaskTemplateLibrary addRequest={{ kind: 'task', householdId: 'household:review', householdLabel: 'Review household' }} onCreate={vi.fn()} />);
    fireEvent.click(screen.getByTestId('crm-task-template-library-open'));
    await screen.findByTestId('crm-task-template-task-template:review');
    fireEvent.click(screen.getByText('Use template'));
    await waitFor(() => { expect(taskCreate).toHaveBeenCalledWith({
      title: 'Prepare review',
      body: '',
      priority: 'normal',
      tagIds: ['tag:active'],
      householdRef: {
        kind: 'household',
        id: 'household:review',
        matterId: 'household:review',
        label: 'Review household',
      },
    }); });
    fireEvent.click(screen.getByTestId('crm-task-template-library-open'));
    await screen.findByTestId('crm-task-template-task-template:review');
    fireEvent.click(screen.getByText('Retire'));
    expect(templateRetire).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Retire template'));
    await waitFor(() => { expect(templateRetire).toHaveBeenCalledWith(template.id); });
  });
});
