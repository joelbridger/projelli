import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

import { LIVE_CRM_RECORDS_CHANGED } from '@/platform/crm/useLiveCrmRecords';
import { useTaskRecordStore } from '@/features/crm-tasks';

describe('task record store canonical reload integration', () => {
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

  it('retains foundation fields through create, canonical reopen, update, and peer refresh', async () => {
    const first = renderHook(() => useTaskRecordStore());
    const created = await first.result.current.create({
      title: 'Prepare annual review',
      householdRef: { kind: 'household', id: 'household-1', matterId: 'matter-1' },
      due: '2026-08-03',
      dueTime: '09:30',
      category: 'Annual review',
      tagIds: ['tag:review'],
      contextRefs: [{ kind: 'document', id: 'Clients/River/review.docx', matterId: 'matter-1', label: 'Review packet' }],
    });
    first.unmount();

    const reopened = renderHook(() => useTaskRecordStore());
    await waitFor(async () => {
      await expect(reopened.result.current.get(created.id)).resolves.toMatchObject({
        dueTime: '09:30',
        category: 'Annual review',
        tagIds: ['tag:review'],
        contextRefs: [{ kind: 'document', id: 'Clients/River/review.docx' }],
      });
    });
    await reopened.result.current.update(created.id, { title: 'Prepare updated review', priority: 'high' });
    await waitFor(async () => {
      await expect(reopened.result.current.get(created.id)).resolves.toMatchObject({
        title: 'Prepare updated review',
        priority: 'high',
        dueTime: '09:30',
        tagIds: ['tag:review'],
      });
    });

    boundary.records = boundary.records.map((record) => record.id === created.id
      ? { ...record, category: 'Peer category' }
      : record);
    act(() => {
      window.dispatchEvent(new Event(LIVE_CRM_RECORDS_CHANGED));
    });
    await waitFor(async () => {
      await expect(reopened.result.current.get(created.id)).resolves.toMatchObject({ category: 'Peer category' });
    });
    reopened.unmount();
  });
});
