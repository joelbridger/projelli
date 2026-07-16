import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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

import {
  useWorkflowTemplateStore,
  WorkflowTemplateError,
} from '@/features/crm-workflows';

describe('public canonical workflow template doorway', () => {
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

  it('creates, updates, publishes, starts, and survives fresh reloads through public exports only', async () => {
    const first = renderHook(() => useWorkflowTemplateStore());
    const created = await first.result.current.create({
      name: 'Annual review',
      tagIds: ['tag:review'],
      steps: [
        { title: 'Prepare', tagIds: ['tag:prepare'] },
        { title: 'Meet', tagIds: ['tag:meeting'] },
      ],
    });
    const originalIds = created.steps.map((step) => step.id);

    await expect(first.result.current.start(created.id, {
      id: 'household-1',
      label: 'River household',
    })).rejects.toEqual(expect.objectContaining<Partial<WorkflowTemplateError>>({
      name: 'WorkflowTemplateError',
      code: 'template_not_published',
    }));
    expect(boundary.records.filter((record) => record.kind === 'crm_workflow_instance')).toHaveLength(0);
    first.unmount();

    const editor = renderHook(() => useWorkflowTemplateStore());
    await waitFor(async () => {
      await expect(editor.result.current.get(created.id)).resolves.toMatchObject({
        status: 'draft',
        tagIds: ['tag:review'],
      });
    });
    const updated = await editor.result.current.update(created.id, {
      name: 'Annual client review',
      tagIds: ['tag:review'],
      steps: [...created.steps].reverse().map((step, position) => ({
        ...step,
        position,
        title: step.title === 'Meet' ? 'Meet with client' : step.title,
      })),
    });
    expect(updated.steps.map((step) => step.id)).toEqual([...originalIds].reverse());
    expect(updated.steps.map((step) => step.tagIds)).toEqual([['tag:meeting'], ['tag:prepare']]);
    await editor.result.current.publish(created.id);
    editor.unmount();

    const starter = renderHook(() => useWorkflowTemplateStore());
    await waitFor(async () => {
      await expect(starter.result.current.get(created.id)).resolves.toMatchObject({
        name: 'Annual client review',
        status: 'published',
      });
    });
    const started = await starter.result.current.start(created.id, {
      id: 'household-1',
      label: 'River household',
      matterId: 'matter-1',
    });
    starter.unmount();

    const reloaded = renderHook(() => useWorkflowTemplateStore());
    await waitFor(async () => {
      await expect(reloaded.result.current.getInstance(started.id)).resolves.toMatchObject({
        templateId: created.id,
        householdId: 'household-1',
        steps: [
          { id: originalIds[1], tagIds: ['tag:meeting'] },
          { id: originalIds[0], tagIds: ['tag:prepare'] },
        ],
      });
    });
    reloaded.unmount();
  });
});
