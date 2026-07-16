import { describe, expect, it } from 'vitest';
import { createTemplate, startWorkflow } from '@/features/crm-home/workflowLive';
import { patchWorkflowStepMetadata } from '@/features/crm-workflows';

function instanceFixture() {
  const template = createTemplate('Annual review', ['Prepare']);
  return startWorkflow(template, { id: 'household-1', label: 'River household' });
}

function firstStepId(instance: ReturnType<typeof instanceFixture>): string {
  const stepId = Object.keys(instance.snapshot.steps)[0];
  if (!stepId) throw new Error('Expected a workflow step.');
  return stepId;
}

describe('public workflow step metadata persistence', () => {
  it('immutably patches one known instance step with stable tag IDs and document references', () => {
    const instance = instanceFixture();
    const stepId = firstStepId(instance);
    const patched = patchWorkflowStepMetadata(instance, stepId, {
      tagIds: ['tag:prep'],
      documentRefs: [{
        kind: 'document',
        id: 'Clients/River/review.docx',
        matterId: 'household-1',
        label: 'Review packet',
      }],
    });

    expect(patched).not.toBe(instance);
    expect(instance.snapshot.steps[stepId]?.tagIds).toEqual([]);
    expect(patched.snapshot.steps[stepId]).toMatchObject({
      tagIds: ['tag:prep'],
      documentRefs: [{ kind: 'document', id: 'Clients/River/review.docx' }],
    });
  });

  it('rejects a missing step or duplicate/malformed metadata without changing the instance', () => {
    const instance = instanceFixture();
    const stepId = firstStepId(instance);
    expect(() => patchWorkflowStepMetadata(instance, 'missing', { tagIds: [] })).toThrow('no longer exists');
    expect(() => patchWorkflowStepMetadata(instance, stepId, {})).toThrow('cannot be empty');
    expect(() => patchWorkflowStepMetadata(instance, stepId, { tagIds: ['tag:one', 'tag:one'] })).toThrow('duplicated');
    expect(() => {
      Reflect.apply(patchWorkflowStepMetadata, undefined, [instance, stepId, {
        documentRefs: [{ kind: 'household', id: 'household-1' }],
      }]);
    }).toThrow('malformed');
    expect(() => patchWorkflowStepMetadata(instance, stepId, {
      documentRefs: [{ kind: 'document', id: '/outside/review.docx' }],
    })).toThrow('malformed');
    expect(() => patchWorkflowStepMetadata(instance, stepId, {
      documentRefs: [
        { kind: 'document', id: 'Clients/River/review.docx' },
        { kind: 'document', id: 'Clients/River/review.docx' },
      ],
    })).toThrow('duplicated');
    expect(instance.snapshot.steps[stepId]).toMatchObject({ tagIds: [], documentRefs: [] });
  });

  it('normalizes missing legacy metadata while patching the requested field', () => {
    const instance = instanceFixture();
    const stepId = firstStepId(instance);
    const step = instance.snapshot.steps[stepId];
    if (!step) throw new Error('Expected a workflow step.');
    Reflect.deleteProperty(step, 'tagIds');
    Reflect.deleteProperty(step, 'documentRefs');

    const patched = patchWorkflowStepMetadata(instance, stepId, { tagIds: ['tag:prep'] });

    expect(patched.snapshot.steps[stepId]).toMatchObject({
      tagIds: ['tag:prep'],
      documentRefs: [],
    });
  });
});
