import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useTaskRecordStore } from '@/features/crm-tasks';
import type { LiveCrmRecord } from '@/platform/crm/liveRecords';
import { useTaskTemplateStore } from './index';

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

function listCallCount(): number {
  return boundary.invoke.mock.calls.filter(([command]) => command === 'crm_live_list').length;
}

describe('task template canonical live-record integration', () => {
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

  it('reopens a tagged template through crm_live_list and applies every supported task field through a fresh task reload', async () => {
    const first = renderHook(() => useTaskTemplateStore());
    await waitFor(() => {
      expect(listCallCount()).toBeGreaterThan(0);
    });
    const created = await first.result.current.create({
      name: 'Review follow-up',
      title: 'Send review notes',
      body: 'Include the agreed next steps.',
      priority: 'high',
      category: 'Follow-up',
      due: '2026-08-03',
      dueTime: '09:30',
      relationPrompt: 'Choose the review household.',
      tagIds: ['tag:review'],
    });
    first.unmount();

    const callsBeforeTemplateReopen = listCallCount();
    const reopened = renderHook(() => useTaskTemplateStore());
    await waitFor(async () => {
      await expect(reopened.result.current.list()).resolves.toEqual([created]);
    });
    expect(listCallCount()).toBeGreaterThan(callsBeforeTemplateReopen);
    const prepared = await reopened.result.current.apply(created.id);
    expect(prepared.taskInput).toEqual({
      title: 'Send review notes',
      body: 'Include the agreed next steps.',
      priority: 'high',
      category: 'Follow-up',
      due: '2026-08-03',
      dueTime: '09:30',
      tagIds: ['tag:review'],
    });
    reopened.unmount();

    const creator = renderHook(() => useTaskRecordStore());
    const task = await creator.result.current.create({
      ...prepared.taskInput,
      householdRef: {
        kind: 'household',
        id: 'household-1',
        matterId: 'matter-1',
        label: 'River household',
      },
    });
    creator.unmount();

    const callsBeforeTaskReopen = listCallCount();
    const taskReader = renderHook(() => useTaskRecordStore());
    await waitFor(async () => {
      await expect(taskReader.result.current.get(task.id)).resolves.toMatchObject({
        title: 'Send review notes',
        body: 'Include the agreed next steps.',
        householdRef: {
          kind: 'household',
          id: 'household-1',
          matterId: 'matter-1',
          label: 'River household',
        },
        priority: 'high',
        category: 'Follow-up',
        due: '2026-08-03',
        dueTime: '09:30',
        tagIds: ['tag:review'],
      });
    });
    expect(listCallCount()).toBeGreaterThan(callsBeforeTaskReopen);
    taskReader.unmount();
  });

  it('preserves identity, leaves an applied template unchanged, and blocks retired templates', async () => {
    const creator = renderHook(() => useTaskTemplateStore());
    const created = await creator.result.current.create({
      name: 'Planning follow-up',
      title: 'Schedule planning check-in',
      priority: 'normal',
      tagIds: ['tag:planning'],
    });
    creator.unmount();

    const editor = renderHook(() => useTaskTemplateStore());
    await waitFor(async () => {
      await expect(editor.result.current.list()).resolves.toHaveLength(1);
    });
    const updated = await editor.result.current.update(created.id, {
      name: 'Planning follow-up',
      title: 'Schedule planning check-in',
      body: 'Use the client decision notes.',
      priority: 'low',
      category: 'Planning',
      due: '2026-09-14',
      dueTime: '15:45',
      tagIds: ['tag:planning'],
    });
    expect(updated.id).toBe(created.id);
    editor.unmount();

    const reader = renderHook(() => useTaskTemplateStore());
    await waitFor(async () => {
      await expect(reader.result.current.list()).resolves.toEqual([updated]);
    });
    const beforeApply = await reader.result.current.list();
    await expect(reader.result.current.apply(updated.id)).resolves.toMatchObject({
      template: updated,
    });
    await expect(reader.result.current.list()).resolves.toEqual(beforeApply);
    await reader.result.current.retire(updated.id);
    reader.unmount();

    const retiredReader = renderHook(() => useTaskTemplateStore());
    await waitFor(async () => {
      await expect(retiredReader.result.current.list()).resolves.toEqual([
        expect.objectContaining({ id: updated.id, retired: true }),
      ]);
    });
    await expect(retiredReader.result.current.apply(updated.id)).rejects.toMatchObject({
      code: 'template_retired',
    });
    await expect(retiredReader.result.current.update(updated.id, {
      name: 'Planning follow-up',
      title: 'Changed',
    })).rejects.toMatchObject({ code: 'template_retired' });
    retiredReader.unmount();
  });
});
