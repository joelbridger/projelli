import { render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  patchWorkflowStepMetadata,
  prepareWorkflowDependentDueCompletion,
} from '@/features/crm-workflows';
import type { LiveCrmRecord } from '@/platform/crm/liveRecords';
import { setDevFlagOverride } from '@/platform/flags';
import { LiveCrmHome, type LiveCrmHomeRuntime } from './shared/LiveCrmHome';
import {
  createTemplate,
  startWorkflow,
  WorkflowCompletionRefusedError,
} from './workflowLive';

const live = vi.hoisted(() => ({
  records: [] as LiveCrmRecord[],
  save: vi.fn<(record: LiveCrmRecord) => Promise<unknown>>(),
  reload: vi.fn<() => Promise<void>>(),
}));

vi.mock('@/platform/crm/useLiveCrmRecords', () => ({
  useLiveCrmRecords: () => ({
    records: live.records,
    save: live.save,
    reload: live.reload,
    workspaceRoot: '/test-workspace',
    freshness: { kind: 'live' as const },
  }),
}));

beforeEach(async () => {
  live.save.mockReset();
  live.save.mockImplementation((record) => Promise.resolve(record));
  live.reload.mockReset();
  live.reload.mockResolvedValue();
  setDevFlagOverride('workflow-dependent-due', true);
  await prepareWorkflowDependentDueCompletion();
});

afterEach(() => {
  setDevFlagOverride('workflow-dependent-due', undefined);
});

describe('dependent-due enforcement from the isolated Today owner', () => {
  it('refuses a later step without importing or mounting LiveWorkflows', async () => {
    const template = createTemplate('Annual review', ['Prepare', 'Meet']);
    const instance = startWorkflow(template, {
      id: 'today-household',
      label: 'River household',
    });
    const [firstId, secondId] = Object.keys(instance.snapshot.steps);
    if (!firstId || !secondId) throw new Error('Expected two workflow steps.');
    const configured = patchWorkflowStepMetadata(instance, secondId, {
      sequential: true,
      dependentDue: {
        base: 'predecessor_completion',
        predecessorStepId: firstId,
        direction: 'after',
        offset: 2,
        unit: 'days',
      },
    });
    live.records = [configured];
    let runtime: LiveCrmHomeRuntime | undefined;

    render(
      <LiveCrmHome
        render={(value) => {
          runtime = value;
          return null;
        }}
      />,
    );
    const workItem = runtime?.adapter.workflowWorkItems?.find(
      (item) => item.instanceId === configured.id && item.stepId === secondId,
    );
    const complete = runtime?.adapter.actions.completeWorkflowWorkItem;
    if (!workItem || !complete) throw new Error('Expected the Today workflow completion action.');

    await expect(complete(workItem)).rejects.toMatchObject({
      refusal: {
        code: 'workflow_dependency_incomplete',
        message: 'Finish “Prepare” before completing this step.',
      },
    });
    await expect(complete(workItem)).rejects.toBeInstanceOf(WorkflowCompletionRefusedError);
    expect(live.save).not.toHaveBeenCalled();
  });
});
