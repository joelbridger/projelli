import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  useWorkflowTemplateStore,
  WorkflowTemplateError,
} from '@/features/crm-workflows';
import type { LiveCrmRecord } from '@/platform/crm/liveRecords';

const canonicalBoundary = vi.hoisted(() => ({
  records: [] as LiveCrmRecord[],
  invoke: vi.fn<
    (command: string, args?: { record?: LiveCrmRecord }) => Promise<unknown>
  >(),
}));

vi.mock('@tauri-apps/api/core', () => ({
  isTauri: () => true,
  invoke: (command: string, args?: { record?: LiveCrmRecord }) =>
    canonicalBoundary.invoke(command, args),
}));
vi.mock('@/platform/utils/wealthbox-commands', () => ({
  crmSetWorkspace: () => Promise.resolve(),
}));
vi.mock('@/platform/fs/workspaceStore', () => ({
  useWorkspaceStore: <T,>(selector: (state: { rootPath: string }) => T) =>
    selector({ rootPath: '/workflow-authoring-proof' }),
}));
vi.mock('@/platform/matter/matterStore', () => ({
  useMatterStore: <T,>(
    selector: (state: { matters: []; activeMatterId: null }) => T
  ) => selector({ matters: [], activeMatterId: null }),
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

function at<T>(items: readonly T[], index: number): T {
  const item = items[index];
  if (!item) throw new Error(`Missing workflow step at index ${String(index)}`);
  return item;
}

describe('workflow authoring through the canonical public doorway', () => {
  beforeEach(() => {
    canonicalBoundary.records = [];
    canonicalBoundary.invoke.mockReset();
    canonicalBoundary.invoke.mockImplementation((command, args) => {
      if (command === 'crm_live_list') {
        return Promise.resolve(structuredClone(canonicalBoundary.records));
      }
      if (command === 'crm_live_upsert' && args?.record) {
        const record = structuredClone(args.record);
        canonicalBoundary.records = canonicalBoundary.records.some(
          (item) => item.id === record.id
        )
          ? canonicalBoundary.records.map((item) =>
              item.id === record.id ? record : item
            )
          : [...canonicalBoundary.records, record];
        return Promise.resolve(structuredClone(record));
      }
      return Promise.reject(new Error(`Unexpected command ${command}`));
    });
  });

  it('reloads, reorders, publishes, and starts canonical tagged records', async () => {
    const creator = renderHook(() => useWorkflowTemplateStore());
    const created = await creator.result.current.create({
      name: 'Annual review',
      tagIds: ['tag:review'],
      steps: [
        { title: 'Prepare', tagIds: ['tag:prepare'] },
        { title: 'Meet', tagIds: ['tag:meeting'] },
        { title: 'Follow up', tagIds: ['tag:follow-up'] },
      ],
    });
    const originalStepIds = created.steps.map((step) => step.id);
    creator.unmount();

    const editor = renderHook(() => useWorkflowTemplateStore());
    await waitFor(async () => {
      await expect(editor.result.current.get(created.id)).resolves.toEqual(
        created
      );
    });
    await expect(
      editor.result.current.start(created.id, {
        id: 'household:river',
        label: 'River household',
      })
    ).rejects.toEqual(
      expect.objectContaining<Partial<WorkflowTemplateError>>({
        name: 'WorkflowTemplateError',
        code: 'template_not_published',
      })
    );
    const reorderedSteps = [
      { ...at(created.steps, 2), position: 0 },
      { ...at(created.steps, 0), position: 1, title: 'Prepare documents' },
      { ...at(created.steps, 1), position: 2 },
    ];
    const updated = await editor.result.current.update(created.id, {
      name: 'Annual client review',
      tagIds: created.tagIds,
      steps: reorderedSteps,
    });
    expect(updated.steps.map((step) => step.id)).toEqual([
      originalStepIds[2],
      originalStepIds[0],
      originalStepIds[1],
    ]);
    expect(updated.steps.map((step) => step.position)).toEqual([0, 1, 2]);

    const upsertsBeforeInvalidEdit = canonicalBoundary.invoke.mock.calls.filter(
      ([command]) => command === 'crm_live_upsert'
    ).length;
    await expect(
      editor.result.current.update(created.id, {
        name: updated.name,
        tagIds: updated.tagIds,
        steps: [
          at(updated.steps, 0),
          { ...at(updated.steps, 1), id: at(updated.steps, 0).id },
          at(updated.steps, 2),
        ],
      })
    ).rejects.toEqual(
      expect.objectContaining<Partial<WorkflowTemplateError>>({
        code: 'invalid_template',
      })
    );
    expect(
      canonicalBoundary.invoke.mock.calls.filter(
        ([command]) => command === 'crm_live_upsert'
      )
    ).toHaveLength(upsertsBeforeInvalidEdit);
    editor.unmount();

    const publisher = renderHook(() => useWorkflowTemplateStore());
    await waitFor(async () => {
      await expect(publisher.result.current.get(created.id)).resolves.toEqual(
        updated
      );
    });
    const published = await publisher.result.current.publish(created.id);
    expect(published.status).toBe('published');
    publisher.unmount();

    const starter = renderHook(() => useWorkflowTemplateStore());
    await waitFor(async () => {
      await expect(starter.result.current.get(created.id)).resolves.toEqual(
        published
      );
    });
    const started = await starter.result.current.start(created.id, {
      id: 'household:river',
      label: 'River household',
      matterId: 'matter:river',
    });
    starter.unmount();

    const verifier = renderHook(() => useWorkflowTemplateStore());
    await waitFor(async () => {
      await expect(verifier.result.current.get(created.id)).resolves.toEqual(
        published
      );
      await expect(
        verifier.result.current.getInstance(started.id)
      ).resolves.toMatchObject({
        templateId: created.id,
        householdId: 'household:river',
        steps: [
          { id: originalStepIds[2], tagIds: ['tag:follow-up'] },
          { id: originalStepIds[0], tagIds: ['tag:prepare'] },
          { id: originalStepIds[1], tagIds: ['tag:meeting'] },
        ],
      });
    });
    verifier.unmount();

    expect(
      canonicalBoundary.invoke.mock.calls.filter(
        ([command]) => command === 'crm_live_list'
      ).length
    ).toBeGreaterThanOrEqual(5);
    expect(
      canonicalBoundary.records.filter(
        (record) => record.kind === 'crm_workflow_template'
      )
    ).toHaveLength(1);
    expect(
      canonicalBoundary.records.filter(
        (record) => record.kind === 'crm_workflow_instance'
      )
    ).toHaveLength(1);
    expect(
      canonicalBoundary.records.some((record) =>
        record.kind.startsWith('workflow_authoring_')
      )
    ).toBe(false);
  });
});
