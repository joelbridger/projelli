import { describe, expect, it, vi } from 'vitest';
import { createTemplate, startWorkflow } from '@/features/crm-home/workflowLive';
import type { LiveCrmRecord } from '@/platform/crm/liveRecords';
import type { LiveWorkflowInstance } from '@/features/crm-home/workflowLive';
import { saveWorkflowStepMetadata } from './workflowStepPersistence';

describe('workflow step extension save callback', () => {
  it('saves one immutable patch through Workflows onSave and returns the saved instance', async () => {
    const template = createTemplate('Annual review', ['Prepare']);
    const instance = startWorkflow(template, { id: 'household-1', label: 'River household' });
    const stepId = Object.keys(instance.snapshot.steps)[0];
    if (!stepId) throw new Error('Expected a workflow step.');
    let persisted = structuredClone(instance);
    const onSave = vi.fn((record: LiveCrmRecord) => {
      persisted = structuredClone(record) as LiveWorkflowInstance;
      return Promise.resolve(structuredClone(persisted));
    });

    const saved = await saveWorkflowStepMetadata(instance, stepId, {
      documentRefs: [{ kind: 'document', id: 'Clients/River/review.docx', matterId: 'household-1' }],
    }, onSave);

    expect(onSave).toHaveBeenCalledOnce();
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ id: instance.id }));
    expect(saved.snapshot.steps[stepId]?.documentRefs).toEqual([
      { kind: 'document', id: 'Clients/River/review.docx', matterId: 'household-1' },
    ]);
    expect(instance.snapshot.steps[stepId]?.documentRefs).toEqual([]);

    const reopened = structuredClone(persisted);
    const removed = await saveWorkflowStepMetadata(reopened, stepId, {
      documentRefs: [],
    }, onSave);
    expect(removed.snapshot.steps[stepId]?.documentRefs).toEqual([]);
  });
});
