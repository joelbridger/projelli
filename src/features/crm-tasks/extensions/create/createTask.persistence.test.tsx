import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FirmTagStore } from '@/features/crm-tags';
import type { LiveCrmRecord } from '@/platform/crm/liveRecords';

const boundary = vi.hoisted(() => ({
  records: [] as LiveCrmRecord[],
  invoke: vi.fn<(command: string, args?: { record?: LiveCrmRecord }) => Promise<unknown>>(),
}));

vi.mock('@tauri-apps/api/core', () => ({
  isTauri: () => true,
  invoke: (command: string, args?: { record?: LiveCrmRecord }) => boundary.invoke(command, args),
}));
vi.mock('@/platform/utils/wealthbox-commands', () => ({ crmSetWorkspace: () => Promise.resolve() }));
vi.mock('@/platform/fs/workspaceStore', () => ({
  useWorkspaceStore: <T,>(selector: (state: { rootPath: string }) => T) => selector({ rootPath: '/workspace' }),
}));
vi.mock('@/platform/matter/matterStore', () => ({
  useMatterStore: <T,>(selector: (state: { matters: []; activeMatterId: null }) => T) => selector({ matters: [], activeMatterId: null }),
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
    boundary.records = [];
    boundary.invoke.mockReset();
    boundary.invoke.mockImplementation((command, args) => {
      if (command === 'crm_live_list') return Promise.resolve(structuredClone(boundary.records));
      if (command === 'crm_live_upsert' && args?.record) {
        const record = structuredClone(args.record);
        boundary.records = boundary.records.some((item) => item.id === record.id)
          ? boundary.records.map((item) => item.id === record.id ? record : item)
          : [...boundary.records, record];
        return Promise.resolve(structuredClone(record));
      }
      return Promise.reject(new Error(`Unexpected command ${command}`));
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('retains composer content, relation, priority, category, and tag IDs after canonical reload', async () => {
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

    const listCallsBeforeReopen = boundary.invoke.mock.calls.filter(([command]) => command === 'crm_live_list').length;
    const reopened = renderHook(() => useTaskRecordStore());
    await waitFor(async () => {
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
    });
    expect(boundary.invoke.mock.calls.filter(([command]) => command === 'crm_live_list').length)
      .toBeGreaterThan(listCallsBeforeReopen);
    reopened.unmount();
  });
});
