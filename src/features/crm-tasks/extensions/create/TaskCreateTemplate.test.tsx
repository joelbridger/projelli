import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setDevFlagOverride } from '@/platform/flags';
import type { TaskRecordStore } from '@/features/crm-tasks';
import type { FirmTagStore } from '@/features/crm-tags';
import { TaskCreateTemplateMount } from './TaskCreateTemplate';

const context = { onCreate: vi.fn() };

function taskStore() {
  const create = vi.fn(() =>
    Promise.resolve({
      id: 'task-created',
      title: 'Created task',
      body: '',
      householdRef: null,
      assigneeUserId: null,
      status: 'open' as const,
      priority: 'normal' as const,
      tagIds: [],
      contextRefs: [],
    })
  );
  const store: TaskRecordStore = {
    get: vi.fn(),
    create,
    update: vi.fn(),
  };
  return { store, create };
}

function tagStore() {
  const catalog = {
    version: 1 as const,
    tags: [
      { id: 'tag:review', name: 'Review', color: '#15803d' as const, status: 'active' as const },
      { id: 'tag:retired', name: 'Old', color: '#64748b' as const, status: 'retired' as const },
    ],
  };
  const list = vi.fn(() => Promise.resolve(catalog));
  const store: FirmTagStore = {
    catalog,
    errorCode: null,
    list,
    create: vi.fn(),
    rename: vi.fn(),
    setColor: vi.fn(),
    retire: vi.fn(),
  };
  return { store, list };
}

afterEach(() => {
  cleanup();
  setDevFlagOverride('task-create-v1', undefined);
});

describe('TaskCreateTemplateMount', () => {
  it('stays inert while the flag is off', () => {
    setDevFlagOverride('task-create-v1', false);
    const createTaskStore = vi.fn(() => taskStore().store);
    const createTagStore = vi.fn(() => tagStore().store);

    const { container } = render(
      <TaskCreateTemplateMount
        context={context}
        createTaskStore={createTaskStore}
        createTagStore={createTagStore}
      />
    );

    expect(container).toBeEmptyDOMElement();
    expect(createTaskStore).not.toHaveBeenCalled();
    expect(createTagStore).not.toHaveBeenCalled();
  });

  it('creates a tagged task with optional details through public stores', async () => {
    setDevFlagOverride('task-create-v1', true);
    const tasks = taskStore();
    const tags = tagStore();

    render(
      <TaskCreateTemplateMount
        context={{
          onCreate: vi.fn(),
          addRequest: {
            kind: 'task',
            householdId: 'household-1',
            householdLabel: 'River household',
          },
        }}
        createTaskStore={() => tasks.store}
        createTagStore={() => tags.store}
      />
    );

    fireEvent.click(screen.getByTestId('task-create-v1-open'));
    fireEvent.change(screen.getByTestId('task-create-v1-title'), {
      target: { value: 'Prepare annual review' },
    });
    fireEvent.change(screen.getByTestId('task-create-v1-description'), {
      target: { value: 'Use the latest statement.' },
    });
    fireEvent.change(screen.getByTestId('task-create-v1-due'), {
      target: { value: '2026-08-03' },
    });
    fireEvent.change(screen.getByTestId('task-create-v1-due-time'), {
      target: { value: '09:30' },
    });
    fireEvent.change(screen.getByTestId('task-create-v1-priority'), {
      target: { value: 'high' },
    });
    fireEvent.change(screen.getByTestId('task-create-v1-category'), {
      target: { value: 'Annual review' },
    });
    fireEvent.click(await screen.findByTestId('task-create-v1-tag-tag:review'));
    expect(screen.getByTestId('task-create-v1-tag-tag:retired')).toBeDisabled();
    fireEvent.click(screen.getByTestId('task-create-v1-save'));

    await waitFor(() => {
      expect(tasks.create).toHaveBeenCalledWith({
        title: 'Prepare annual review',
        body: 'Use the latest statement.',
        due: '2026-08-03',
        dueTime: '09:30',
        priority: 'high',
        category: 'Annual review',
        householdRef: {
          kind: 'household',
          id: 'household-1',
          label: 'River household',
        },
        tagIds: ['tag:review'],
      });
    });
    expect(tags.list).toHaveBeenCalled();
    expect(screen.getByTestId('task-create-v1-saved')).toHaveTextContent('task-created');
  });
});
