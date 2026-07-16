import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FirmTagStore } from '@/features/crm-tags';

const canonical = vi.hoisted(() => ({
  records: [] as Record<string, unknown>[],
  save: vi.fn<(record: Record<string, unknown>) => Promise<Record<string, unknown>>>(),
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
import { createTask } from './contract';

function tags(): FirmTagStore {
  const catalog = {
    version: 1 as const,
    tags: [
      { id: 'tag:review', name: 'Review', color: '#15803d' as const, status: 'active' as const },
    ],
  };
  return {
    catalog,
    errorCode: null,
    list: () => Promise.resolve(catalog),
    create: vi.fn(),
    rename: vi.fn(),
    setColor: vi.fn(),
    retire: vi.fn(),
  };
}

describe('task create v1 persistence', () => {
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

  it('retains composer content, relation, priority, category, and tag IDs after save and reload', async () => {
    const first = renderHook(() => useTaskRecordStore());
    const saved = await createTask(first.result.current, tags(), {
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
    });
    first.unmount();

    const reopened = renderHook(() => useTaskRecordStore());
    await expect(reopened.result.current.get(saved.id)).resolves.toMatchObject({
      id: saved.id,
      title: 'Prepare annual review',
      body: 'Use the latest statement.',
      householdRef: {
        kind: 'household',
        id: 'household-1',
        matterId: 'matter-1',
        label: 'River household',
      },
      due: '2026-08-03',
      dueTime: '09:30',
      priority: 'high',
      category: 'Annual review',
      tagIds: ['tag:review'],
    });
    expect(canonical.reload).toHaveBeenCalledOnce();
    reopened.unmount();
  });
});
