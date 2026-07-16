import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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

import { useTaskRecordStore } from '@/features/crm-tasks';

describe('public task record store', () => {
  beforeEach(() => {
    canonical.records = [];
    canonical.save.mockReset();
    canonical.reload.mockReset();
    canonical.save.mockImplementation((record) => {
      canonical.records = [...canonical.records, structuredClone(record)];
      return Promise.resolve(structuredClone(record));
    });
    canonical.reload.mockResolvedValue(undefined);
  });

  it('creates a complete canonical task through the live record route', async () => {
    const { result } = renderHook(() => useTaskRecordStore());

    const created = await result.current.create({
      title: 'Prepare annual review',
      body: 'Use the latest statement.',
      householdRef: {
        kind: 'household',
        id: 'household-1',
        matterId: 'matter-1',
        label: 'River household',
      },
      assigneeUserId: 'advisor-1',
      status: 'open',
      due: '2026-08-03',
      dueTime: '09:30',
      priority: 'high',
      category: 'Annual review',
      tagIds: ['tag:review'],
      contextRefs: [
        {
          kind: 'document',
          id: 'Clients/River/review.docx',
          matterId: 'matter-1',
          label: 'Review packet',
        },
      ],
    });

    expect(created).toMatchObject({
      title: 'Prepare annual review',
      category: 'Annual review',
      dueTime: '09:30',
      tagIds: ['tag:review'],
      contextRefs: [{ kind: 'document', id: 'Clients/River/review.docx' }],
    });
    expect(canonical.save).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'task',
      schemaVersion: 1,
      category: 'Annual review',
      dueTime: '09:30',
      tagIds: ['tag:review'],
    }));
    expect(canonical.reload).toHaveBeenCalledOnce();
  });

  it('merges an update into the current canonical task and retains unrelated fields and relations', async () => {
    canonical.records = [{
      id: 'task-1',
      kind: 'task',
      matterId: 'firm_home',
      title: 'Prepare review',
      body: '',
      assigneeUserId: null,
      status: 'open',
      dueTime: '09:30',
      priority: 'high',
      category: 'Annual review',
      tagIds: ['tag:review'],
      householdRef: { kind: 'household', id: 'household-1', matterId: 'matter-1' },
      contextRefs: [
        { kind: 'household', id: 'household-1', matterId: 'matter-1' },
        { kind: 'document', id: 'Clients/River/review.docx', matterId: 'matter-1', label: 'Review packet' },
      ],
      connectorOwned: 'keep me',
    }];
    canonical.save.mockImplementation((record) => {
      canonical.records = [structuredClone(record)];
      return Promise.resolve(structuredClone(record));
    });
    const { result } = renderHook(() => useTaskRecordStore());

    const updated = await result.current.update('task-1', {
      title: 'Prepare updated review',
      priority: 'normal',
    });

    expect(updated).toMatchObject({
      title: 'Prepare updated review',
      category: 'Annual review',
      dueTime: '09:30',
      tagIds: ['tag:review'],
      contextRefs: [{ kind: 'document', id: 'Clients/River/review.docx' }],
    });
    const savedCall = canonical.save.mock.calls[0]?.[0];
    expect(savedCall).toMatchObject({
      connectorOwned: 'keep me',
      householdRef: { kind: 'household', id: 'household-1', matterId: 'matter-1' },
    });
    expect(savedCall?.['contextRefs']).toEqual(expect.arrayContaining([
      { kind: 'document', id: 'Clients/River/review.docx', matterId: 'matter-1', label: 'Review packet' },
    ]));
  });

  it('rejects malformed due times and duplicate IDs without writing', async () => {
    const { result } = renderHook(() => useTaskRecordStore());

    await expect(result.current.create({ title: 'Bad time', dueTime: '9:30' }))
      .rejects.toThrow('HH:mm');
    await expect(result.current.create({ title: 'Duplicate tags', tagIds: ['tag:one', 'tag:one'] }))
      .rejects.toThrow('must not be duplicated');
    await expect(result.current.create({
      title: 'Unsafe document',
      contextRefs: [{ kind: 'document', id: 'C:\\outside\\secret.pdf' }],
    })).rejects.toThrow('malformed');
    await expect(result.current.create({
      title: 'Wrong client document',
      householdRef: { kind: 'household', id: 'household-1', matterId: 'matter-1' },
      contextRefs: [{ kind: 'document', id: 'Clients/Other/secret.pdf', matterId: 'matter-2' }],
    })).rejects.toThrow('same client');
    await expect(result.current.create({
      title: 'Unscoped client document',
      householdRef: { kind: 'household', id: 'household-1', matterId: 'matter-1' },
      contextRefs: [{ kind: 'document', id: 'Clients/River/review.pdf' }],
    })).rejects.toThrow('same client');
    expect(canonical.save).not.toHaveBeenCalled();
  });

  it('refuses to reassign a linked task across clients without replacing its document refs', async () => {
    canonical.records = [{
      id: 'task-1',
      kind: 'task',
      matterId: 'firm_home',
      title: 'Prepare review',
      body: '',
      assigneeUserId: null,
      status: 'open',
      priority: 'normal',
      tagIds: [],
      householdRef: { kind: 'household', id: 'household-1', matterId: 'matter-1' },
      contextRefs: [{ kind: 'document', id: 'Clients/River/review.pdf', matterId: 'matter-1' }],
    }];
    const { result } = renderHook(() => useTaskRecordStore());

    await expect(result.current.update('task-1', {
      householdRef: { kind: 'household', id: 'household-2', matterId: 'matter-2' },
    })).rejects.toThrow('same client');
    expect(canonical.save).not.toHaveBeenCalled();
  });
});
