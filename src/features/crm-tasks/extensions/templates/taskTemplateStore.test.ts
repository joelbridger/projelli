import { describe, expect, it, vi } from 'vitest';
import type { LiveCrmRecord } from '@/platform/crm/liveRecords';
import { createTaskTemplateStore } from './taskTemplateStore';

function port(records: readonly LiveCrmRecord[], saved: LiveCrmRecord[]) {
  return {
    records,
    workspaceRoot: '/workspace',
    error: null,
    save: vi.fn((record: LiveCrmRecord) => Promise.resolve().then(() => {
      const next = { ...record };
      const index = saved.findIndex((candidate) => candidate.id === next.id);
      if (index >= 0) saved[index] = next;
      else saved.push(next);
      return next;
    })),
    reload: vi.fn(() => Promise.resolve()),
  };
}

describe('task template persistence', () => {
  it('saves a tagged template, reloads, and reads it from a fresh canonical snapshot', async () => {
    const saved: LiveCrmRecord[] = [];
    const firstPort = port([], saved);
    const first = createTaskTemplateStore(firstPort);

    const created = await first.create({
      name: 'Review follow-up',
      title: 'Send review notes',
      body: 'Include the agreed next steps.',
      priority: 'high',
      category: 'Follow-up',
      relationPrompt: 'Choose the review household.',
      tagIds: ['tag:review'],
    });

    expect(firstPort.save).toHaveBeenCalledTimes(1);
    expect(firstPort.reload).toHaveBeenCalledTimes(1);
    const reopenedPort = port(saved, saved);
    const reopened = createTaskTemplateStore(reopenedPort);
    await expect(reopened.list()).resolves.toEqual([created]);
  });

  it('preserves stable template identity and does not mutate a saved template when applying it', async () => {
    const saved: LiveCrmRecord[] = [];
    const store = createTaskTemplateStore(port([], saved));
    const created = await store.create({
      name: 'Planning follow-up',
      title: 'Schedule planning check-in',
      priority: 'normal',
      tagIds: ['tag:planning'],
    });
    const updated = await store.update(created.id, {
      name: 'Planning follow-up',
      title: 'Schedule planning check-in',
      body: 'Use the client decision notes.',
      priority: 'low',
      category: 'Planning',
      tagIds: ['tag:planning'],
    });
    const beforeApply = await store.list();

    const applied = await store.apply(updated.id);

    expect(updated.id).toBe(created.id);
    expect(applied.taskInput).toEqual({
      title: 'Schedule planning check-in',
      body: 'Use the client decision notes.',
      priority: 'low',
      category: 'Planning',
      tagIds: ['tag:planning'],
    });
    await expect(store.list()).resolves.toEqual(beforeApply);
  });

  it('retired templates cannot be edited or applied', async () => {
    const saved: LiveCrmRecord[] = [];
    const store = createTaskTemplateStore(port([], saved));
    const created = await store.create({ name: 'Old', title: 'Old task' });
    await store.retire(created.id);

    await expect(store.apply(created.id)).rejects.toMatchObject({
      code: 'template_retired',
    });
    await expect(store.update(created.id, { name: 'Old', title: 'Changed' })).rejects.toMatchObject({
      code: 'template_retired',
    });
  });
});
