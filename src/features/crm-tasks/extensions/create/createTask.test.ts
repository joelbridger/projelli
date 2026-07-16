import { describe, expect, it, vi } from 'vitest';
import type { TaskRecordStore } from '@/features/crm-tasks';
import type { FirmTagStore } from '@/features/crm-tags';
import { createTask } from './contract';

function tagStore(tags: FirmTagStore['catalog']['tags']) {
  const catalog = { version: 1 as const, tags };
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

describe('createTask public contract', () => {
  it('validates tag IDs through the public catalog then writes the canonical task input', async () => {
    const tasks = taskStore();
    const tags = tagStore([
      { id: 'tag:review', name: 'Review', color: '#15803d', status: 'active' },
    ]);

    await expect(
      createTask(tasks.store, tags.store, {
        title: 'Prepare annual review',
        description: 'Use the latest statement.',
        due: '2026-08-03',
        dueTime: '09:30',
        priority: 'high',
        category: 'Annual review',
        relatedRecord: {
          kind: 'household',
          id: 'household-1',
          matterId: 'matter-1',
          label: 'River household',
        },
        tagIds: ['tag:review'],
      })
    ).resolves.toEqual({ id: 'task-created' });

    expect(tags.list).toHaveBeenCalledOnce();
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
        matterId: 'matter-1',
        label: 'River household',
      },
      tagIds: ['tag:review'],
    });
  });

  it('rejects retired tags and malformed related records before writing', async () => {
    const tasks = taskStore();
    const tags = tagStore([
      { id: 'tag:retired', name: 'Old', color: '#64748b', status: 'retired' },
    ]);

    await expect(
      createTask(tasks.store, tags.store, {
        title: 'Old tagged task',
        tagIds: ['tag:retired'],
      })
    ).rejects.toThrow('active firm tags');
    await expect(
      createTask(tasks.store, tagStore([]).store, {
        title: 'Broken relation',
        relatedRecord: { kind: 'household', id: ' ', label: 'Broken' },
      })
    ).rejects.toThrow('related record is malformed');
    await expect(
      createTask(tasks.store, tagStore([]).store, {
        title: 'Wrong relation kind',
        relatedRecord: { kind: 'document', id: 'document-1' } as never,
      })
    ).rejects.toThrow('related record is malformed');

    expect(tasks.create).not.toHaveBeenCalled();
  });
});
