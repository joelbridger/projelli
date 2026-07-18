import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LiveWorkflows } from '@/features/crm-workflows/Workflows';
import type { LiveCrmRecord } from '@/platform/crm/liveRecords';
import { LiveCrmHome, type LiveCrmHomeRuntime } from './shared/LiveCrmHome';
import {
  createTemplate,
  registerWorkflowCompletionValidator,
  startWorkflow,
  workflowRecords,
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

const refusal = {
  code: 'dependency_incomplete',
  message: 'Finish the required earlier step first.',
};

describe('workflow completion production entry points', () => {
  beforeEach(() => {
    live.records = [];
    live.save.mockReset();
    live.save.mockImplementation((record) => Promise.resolve(record));
    live.reload.mockReset();
    live.reload.mockResolvedValue();
  });

  it('shows a refusal in Workflows and never calls its save boundary', async () => {
    const template = createTemplate('Annual review', ['Prepare review']);
    const instance = startWorkflow(
      template,
      { id: 'household-workflows', label: 'River household' },
      { id: 'workflows-refusal-instance' }
    );
    const step = template.steps[0];
    if (!step) throw new Error('Expected a workflow template step.');
    const stepId = step.id;
    registerWorkflowCompletionValidator(({ instance: candidate }) =>
      candidate.id === instance.id ? { ok: false, refusal } : { ok: true }
    );
    const save = vi.fn<(record: LiveCrmRecord) => Promise<unknown>>();

    render(
      <LiveWorkflows
        data={workflowRecords([template, instance])}
        households={[
          {
            id: 'household-workflows',
            matterId: 'household-workflows',
            label: 'River household',
          },
        ]}
        onSave={save}
        onNavigate={vi.fn()}
      />
    );

    const completeButton = screen.getByTestId(
      `crm-live-workflow-complete-${instance.id}-${stepId}`
    );
    const stepRow = screen.getByTestId(
      `crm-live-workflow-instance-step-${stepId}`
    );
    fireEvent.click(completeButton);

    await waitFor(() => {
      const nearbyRefusal = within(stepRow).getByRole('alert');
      expect(nearbyRefusal).toHaveTextContent(refusal.message);
      expect(nearbyRefusal).toHaveFocus();
    });
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(
      screen.getByTestId(
        `crm-live-workflow-completion-refusal-${instance.id}-${stepId}`
      ).parentElement
    ).toContainElement(completeButton);
    expect(save).not.toHaveBeenCalled();
  });

  it('validates a migration recreation before saving its new template or any other record', async () => {
    live.records = [
      {
        id: 'household-migration-refusal',
        kind: 'household',
        matterId: 'matter-migration-refusal',
        name: 'River household',
      },
      {
        id: 'migration-checklist-refusal',
        kind: 'migration_workflow_checklist',
        matterId: 'firm',
        householdId: 'household-migration-refusal',
        clientLabel: 'River household',
        sourceTemplateLabel: 'Imported annual review',
        activityEvidence: ['Imported activity trace'],
        availableSteps: ['Prepare review', 'Meet with client'],
      },
    ];
    registerWorkflowCompletionValidator(({ instance: candidate }) =>
      candidate.householdId === 'household-migration-refusal'
        ? { ok: false, refusal }
        : { ok: true }
    );
    let runtime: LiveCrmHomeRuntime | undefined;
    render(
      <LiveCrmHome
        render={(nextRuntime) => {
          runtime = nextRuntime;
          return null;
        }}
      />
    );
    const checklist = runtime?.adapter.migration.workflowChecklists[0];
    const recordWorkflowChecklist =
      runtime?.adapter.actions.recordWorkflowChecklist;
    if (!checklist || !recordWorkflowChecklist)
      throw new Error('Expected the live migration checklist action.');

    const attempt = recordWorkflowChecklist({
      ...checklist,
      evidenceReviewed: true,
      selectedCurrentStep: 'Meet with client',
      decision: 'recreate',
      resultingInstanceLabel: 'Imported annual review',
    });

    await expect(attempt).rejects.toBeInstanceOf(
      WorkflowCompletionRefusedError
    );
    expect(live.save).not.toHaveBeenCalled();
  });
});
