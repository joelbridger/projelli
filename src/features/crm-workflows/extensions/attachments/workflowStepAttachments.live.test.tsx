import { act, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkspaceDocumentRef } from '@/features/crm-documents';
import {
  LiveCrmHome,
  type LiveCrmHomeRuntime,
} from '@/features/crm-home';
import {
  createTemplate,
  startWorkflow,
  type LiveWorkflowInstance,
} from '@/features/crm-home/workflowLive';
import type {
  WorkflowStepExtensionContext,
  WorkflowStepMetadataPatch,
} from '@/features/crm-workflows';
import type { LiveCrmRecord } from '@/platform/crm/liveRecords';
import { useMatterStore } from '@/platform/matter/matterStore';
import { useWorkspaceStore } from '@/platform/fs/workspaceStore';
import { saveWorkflowStepMetadata } from '../../workflowStepPersistence';
import {
  addWorkflowStepAttachmentRef,
  listWorkflowStepAttachmentRefs,
  removeWorkflowStepAttachmentRef,
} from './contract';

const boundary = vi.hoisted(() => ({
  committedRecords: [] as LiveCrmRecord[],
  invoke: vi.fn<(command: string, args?: { record?: LiveCrmRecord }) => Promise<unknown>>(),
  writerEcho: undefined as LiveCrmRecord | undefined,
}));

vi.mock('@tauri-apps/api/core', () => ({
  isTauri: () => true,
  invoke: (command: string, args?: { record?: LiveCrmRecord }) => boundary.invoke(command, args),
}));

type MountedConsumer = {
  current(): LiveCrmHomeRuntime | undefined;
  unmount(): void;
};

function taggedInstance(): LiveWorkflowInstance {
  const template = createTemplate('Annual review', ['Prepare']);
  const templateStep = template.steps[0];
  if (!templateStep) throw new Error('Expected template step.');
  templateStep.tagIds = ['tag-prep'];
  return startWorkflow(template, {
    id: 'household-river',
    label: 'River household',
    matterId: 'matter-river',
  });
}

function mountFreshConsumer(): MountedConsumer {
  let latest: LiveCrmHomeRuntime | undefined;
  const view = render(
    <LiveCrmHome render={(runtime) => {
      latest = runtime;
      return null;
    }} />
  );
  return { current: () => latest, unmount: view.unmount };
}

async function loadedRuntime(consumer: MountedConsumer): Promise<LiveCrmHomeRuntime> {
  await waitFor(() => {
    expect(consumer.current()?.workflowData?.instances).toHaveLength(1);
  });
  const runtime = consumer.current();
  if (!runtime) throw new Error('Expected a loaded live CRM consumer.');
  return runtime;
}

function attachmentContext(runtime: LiveCrmHomeRuntime): WorkflowStepExtensionContext & {
  saveStepMetadata: ReturnType<typeof vi.fn<(patch: WorkflowStepMetadataPatch) => Promise<LiveWorkflowInstance>>>;
} {
  const instance = runtime.workflowData?.instances[0];
  const saveLiveRecord = runtime.saveLiveRecord;
  if (!instance || !saveLiveRecord) throw new Error('Expected a live workflow save route.');
  const stepId = Object.keys(instance.snapshot.steps)[0];
  if (!stepId) throw new Error('Expected a stable workflow step.');
  const saveStepMetadata = vi.fn((patch: WorkflowStepMetadataPatch) =>
    saveWorkflowStepMetadata(instance, stepId, patch, saveLiveRecord)
  );
  return {
    instance,
    stepId,
    compatibilityMount: null,
    saveStepMetadata,
  };
}

async function expectSaveThenCanonicalReload(): Promise<void> {
  await waitFor(() => {
    const commands = boundary.invoke.mock.calls.map(([command]) => command);
    const save = commands.indexOf('crm_live_upsert');
    expect(save).toBeGreaterThanOrEqual(0);
    expect(commands.slice(save + 1)).toContain('crm_live_list');
  });
}

describe('workflow-step attachment canonical live route', () => {
  beforeEach(() => {
    boundary.committedRecords = [taggedInstance()];
    boundary.writerEcho = undefined;
    boundary.invoke.mockReset();
    boundary.invoke.mockImplementation((command, args) => {
      if (command === 'crm_set_workspace') return Promise.resolve();
      if (command === 'crm_live_list') {
        return Promise.resolve(structuredClone(boundary.committedRecords));
      }
      if (command === 'crm_live_upsert' && args?.record) {
        const saved = structuredClone(args.record);
        boundary.writerEcho = saved;
        boundary.committedRecords = boundary.committedRecords.some((record) => record.id === saved.id)
          ? boundary.committedRecords.map((record) => record.id === saved.id ? saved : record)
          : [...boundary.committedRecords, saved];
        return Promise.resolve(structuredClone(saved));
      }
      return Promise.reject(new Error(`Unexpected command ${command}`));
    });
    useWorkspaceStore.setState({ rootPath: '/workspace' });
    useMatterStore.setState({ matters: [], activeMatterId: null });
  });

  afterEach(() => {
    useWorkspaceStore.setState({ rootPath: null, fileTree: [] });
    useMatterStore.setState({ matters: [], activeMatterId: null });
    vi.clearAllMocks();
  });

  it('saves, freshly reloads, projects tags, removes, and freshly reloads again', async () => {
    const writer = mountFreshConsumer();
    const writerRuntime = await loadedRuntime(writer);
    const writerContext = attachmentContext(writerRuntime);
    const stableStepId = writerContext.stepId;
    boundary.invoke.mockClear();

    await act(async () => {
      await addWorkflowStepAttachmentRef(writerContext, {
        kind: 'document',
        id: 'Clients/River/review.docx',
        label: 'review.docx',
        matterId: 'matter-river',
      });
    });
    await expectSaveThenCanonicalReload();
    expect(writerContext.saveStepMetadata).toHaveBeenCalledOnce();
    writer.unmount();
    boundary.writerEcho = undefined;

    const reopened = mountFreshConsumer();
    const reopenedRuntime = await loadedRuntime(reopened);
    const reopenedContext = attachmentContext(reopenedRuntime);
    const reopenedStep = reopenedContext.instance.snapshot.steps[stableStepId];
    expect(reopenedContext.stepId).toBe(stableStepId);
    expect(listWorkflowStepAttachmentRefs(reopenedContext)).toEqual([{
      kind: 'document',
      id: 'Clients/River/review.docx',
      label: 'review.docx',
      matterId: 'matter-river',
    }]);
    expect(reopenedStep?.tagIds).toEqual(['tag-prep']);
    expect(reopenedRuntime.adapter.workflowWorkItems).toEqual([
      expect.objectContaining({
        instanceId: reopenedContext.instance.id,
        stepId: stableStepId,
        tagIds: ['tag-prep'],
      }),
    ]);
    expect(reopenedRuntime.adapter.workflowWorkItems?.[0]).not.toHaveProperty('tagNames');
    expect(reopenedRuntime.adapter.workflowWorkItems?.[0]).not.toHaveProperty('tagColors');
    expect(boundary.writerEcho).toBeUndefined();
    boundary.invoke.mockClear();

    await act(async () => {
      await removeWorkflowStepAttachmentRef(
        reopenedContext,
        'Clients/River/review.docx',
      );
    });
    await expectSaveThenCanonicalReload();
    reopened.unmount();
    boundary.writerEcho = undefined;

    const removedReopen = mountFreshConsumer();
    const removedRuntime = await loadedRuntime(removedReopen);
    const removedContext = attachmentContext(removedRuntime);
    expect(removedContext.stepId).toBe(stableStepId);
    expect(listWorkflowStepAttachmentRefs(removedContext)).toEqual([]);
    expect(removedContext.instance.snapshot.steps[stableStepId]?.tagIds).toEqual(['tag-prep']);
    expect(removedRuntime.adapter.workflowWorkItems?.[0]).toMatchObject({
      stepId: stableStepId,
      tagIds: ['tag-prep'],
    });
    expect(boundary.writerEcho).toBeUndefined();
    removedReopen.unmount();
  });

  it('refuses forged absolute references before the typed save callback', async () => {
    const consumer = mountFreshConsumer();
    const runtime = await loadedRuntime(consumer);
    const context = attachmentContext(runtime);
    boundary.invoke.mockClear();
    const forged: readonly WorkspaceDocumentRef[] = [
      { kind: 'document', id: '/etc/review.docx', label: 'review.docx', matterId: 'matter-river' },
      { kind: 'document', id: 'C:/Clients/River/review.docx', label: 'review.docx', matterId: 'matter-river' },
    ];

    for (const reference of forged) {
      await expect(addWorkflowStepAttachmentRef(context, reference))
        .rejects.toMatchObject({ code: 'malformed' });
    }

    expect(context.saveStepMetadata).not.toHaveBeenCalled();
    expect(boundary.invoke.mock.calls.map(([command]) => command))
      .not.toContain('crm_live_upsert');
    consumer.unmount();
  });
});
