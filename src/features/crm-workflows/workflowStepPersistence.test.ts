import { afterEach, describe, expect, it } from 'vitest';
import {
  applyWorkflowStepCompletion,
  createTemplate,
  startWorkflow,
  WorkflowCompletionRefusedError,
} from '@/features/crm-home/workflowLive';
import { patchWorkflowStepMetadata } from '@/features/crm-workflows';
import { setDevFlagOverride } from '@/platform/flags';
import { readWorkflowStepTiming } from './workflowStepPersistence';

function instanceFixture() {
  const template = createTemplate('Annual review', ['Prepare']);
  return startWorkflow(template, { id: 'household-1', label: 'River household' });
}

function firstStepId(instance: ReturnType<typeof instanceFixture>): string {
  const stepId = Object.keys(instance.snapshot.steps)[0];
  if (!stepId) throw new Error('Expected a workflow step.');
  return stepId;
}

afterEach(() => {
  setDevFlagOverride('workflow-dependent-due', undefined);
});

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
        { kind: 'document', id: 'Clients/River/review.docx', matterId: 'household-1' },
        { kind: 'document', id: 'Clients/River/review.docx', matterId: 'household-1' },
      ],
    })).toThrow('duplicated');
    expect(() => patchWorkflowStepMetadata(instance, stepId, {
      documentRefs: [{ kind: 'document', id: 'Clients/Other/review.docx', matterId: 'household-2' }],
    })).toThrow('same client');
    expect(() => patchWorkflowStepMetadata(instance, stepId, {
      documentRefs: [{ kind: 'document', id: 'Clients/River/review.docx' }],
    })).toThrow('same client');
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

  it('uses the household client matter rather than its CRM record id', () => {
    const template = createTemplate('Annual review', ['Prepare']);
    const instance = startWorkflow(template, {
      id: 'household-1',
      matterId: 'matter-1',
      label: 'River household',
    });
    const stepId = firstStepId(instance);

    const patched = patchWorkflowStepMetadata(instance, stepId, {
      documentRefs: [{
        kind: 'document',
        id: 'Clients/River/review.docx',
        matterId: 'matter-1',
      }],
    });

    expect(instance.matterId).toBe('matter-1');
    expect(patched.snapshot.steps[stepId]?.documentRefs).toHaveLength(1);
    expect(() => patchWorkflowStepMetadata(instance, stepId, {
      documentRefs: [{
        kind: 'document',
        id: 'Clients/River/review.docx',
        matterId: 'household-1',
      }],
    })).toThrow('same client');
  });

  it('stores one immediate predecessor and derives days, weeks, and clipped months from saved timestamps', () => {
    const template = createTemplate('Annual review', ['Prepare', 'Meet', 'Follow up']);
    const instance = startWorkflow(template, { id: 'household-1', label: 'River household' });
    instance.createdAt = '2026-01-31T09:30:00.000Z';
    const [firstId, secondId, thirdId] = Object.keys(instance.snapshot.steps);
    if (!firstId || !secondId || !thirdId) throw new Error('Expected three workflow steps.');

    const first = patchWorkflowStepMetadata(instance, firstId, {
      dependentDue: { base: 'workflow_start', direction: 'after', offset: 1, unit: 'months' },
      sequential: true,
    });
    expect(readWorkflowStepTiming(first, firstId)).toMatchObject({
      sequential: true,
      dueAt: '2026-02-28T09:30:00.000Z',
    });

    first.snapshot.steps[firstId]?.completionOperations.push({
      completionId: 'complete-first',
      completedBy: 'advisor',
      completedAt: '2026-03-01T10:00:00.000Z',
      sourceOperationId: 'complete-first-operation',
    });
    const second = patchWorkflowStepMetadata(first, secondId, {
      dependentDue: {
        base: 'predecessor_completion',
        predecessorStepId: firstId,
        direction: 'before',
        offset: 2,
        unit: 'weeks',
      },
    });
    expect(readWorkflowStepTiming(second, secondId).dueAt).toBe('2026-02-15T10:00:00.000Z');
    expect(() => patchWorkflowStepMetadata(second, thirdId, {
      dependentDue: {
        base: 'predecessor_completion',
        predecessorStepId: firstId,
        direction: 'after',
        offset: 2,
        unit: 'days',
      },
    })).toThrow('immediately previous');
  });

  it('rejects unknown, self, forward, multiple, malformed, invalid-offset, invalid-unit, and cyclic rules immutably', () => {
    const template = createTemplate('Annual review', ['Prepare', 'Meet', 'Follow up']);
    const instance = startWorkflow(template, { id: 'household-1', label: 'River household' });
    const [firstId, secondId, thirdId] = Object.keys(instance.snapshot.steps);
    if (!firstId || !secondId || !thirdId) throw new Error('Expected three workflow steps.');
    const dependent = (predecessorStepId: string) => ({
      base: 'predecessor_completion' as const,
      predecessorStepId,
      direction: 'after' as const,
      offset: 1,
      unit: 'days' as const,
    });

    expect(() => patchWorkflowStepMetadata(instance, secondId, { dependentDue: dependent('missing') }))
      .toThrow('no longer exists');
    expect(() => patchWorkflowStepMetadata(instance, secondId, { dependentDue: dependent(secondId) }))
      .toThrow('depend on itself');
    expect(() => patchWorkflowStepMetadata(instance, secondId, { dependentDue: dependent(thirdId) }))
      .toThrow('immediately previous');
    expect(() => {
      void Reflect.apply(patchWorkflowStepMetadata, undefined, [instance, secondId, {
        dependentDue: { ...dependent(firstId), predecessorStepIds: [firstId, thirdId] },
      }]);
    }).toThrow('multiple predecessors');
    expect(() => {
      void Reflect.apply(patchWorkflowStepMetadata, undefined, [instance, secondId, {
        dependentDue: { ...dependent(firstId), direction: 'sideways' },
      }]);
    }).toThrow('valid direction');
    expect(() => {
      void Reflect.apply(patchWorkflowStepMetadata, undefined, [instance, secondId, {
        dependentDue: { ...dependent(firstId), offset: -1 },
      }]);
    }).toThrow('non-negative whole numbers');
    expect(() => {
      void Reflect.apply(patchWorkflowStepMetadata, undefined, [instance, secondId, {
        dependentDue: { ...dependent(firstId), unit: 'hours' },
      }]);
    }).toThrow('valid unit');

    const cyclic = structuredClone(instance);
    cyclic['workflowDependentDue'] = {
      version: 1,
      sequential: true,
      steps: {
        [firstId]: dependent(secondId),
        [secondId]: dependent(firstId),
      },
    };
    expect(() => readWorkflowStepTiming(cyclic, secondId)).toThrow('cycle');
    expect(instance['workflowDependentDue']).toBeUndefined();
  });

  it('refuses out-of-order completion with a typed error and keeps the candidate unchanged', () => {
    setDevFlagOverride('workflow-dependent-due', true);
    const template = createTemplate('Annual review', ['Prepare', 'Meet']);
    const instance = startWorkflow(template, { id: 'household-1', label: 'River household' });
    const [firstId, secondId] = Object.keys(instance.snapshot.steps);
    if (!firstId || !secondId) throw new Error('Expected two workflow steps.');
    const configured = patchWorkflowStepMetadata(instance, secondId, {
      dependentDue: {
        base: 'predecessor_completion',
        predecessorStepId: firstId,
        direction: 'after',
        offset: 2,
        unit: 'days',
      },
      sequential: true,
    });

    expect(() => applyWorkflowStepCompletion(configured, secondId)).toThrow(WorkflowCompletionRefusedError);
    try {
      applyWorkflowStepCompletion(configured, secondId);
    } catch (error) {
      expect((error as WorkflowCompletionRefusedError).refusal).toEqual({
        code: 'workflow_dependency_incomplete',
        message: 'Finish “Prepare” before completing this step.',
      });
    }
    expect(configured.snapshot.steps[firstId]?.status).toBe('todo');
    expect(configured.snapshot.steps[secondId]?.status).toBe('todo');
  });

  it('never rewrites a completed dependent due rule or completion history', () => {
    const template = createTemplate('Annual review', ['Prepare', 'Meet']);
    const instance = startWorkflow(template, { id: 'household-1', label: 'River household' });
    const [firstId, secondId] = Object.keys(instance.snapshot.steps);
    if (!firstId || !secondId) throw new Error('Expected two workflow steps.');
    const configured = patchWorkflowStepMetadata(instance, secondId, {
      dependentDue: {
        base: 'predecessor_completion', predecessorStepId: firstId,
        direction: 'after', offset: 2, unit: 'days',
      },
    });
    const completed = structuredClone(configured);
    const step = completed.snapshot.steps[secondId];
    if (!step) throw new Error('Expected dependent step.');
    step.status = 'done';
    step.completionOperations.push({
      completionId: 'dependent-completion', completedBy: 'advisor',
      completedAt: '2026-03-04T10:00:00.000Z', sourceOperationId: 'dependent-operation',
    });

    expect(() => patchWorkflowStepMetadata(completed, secondId, { dependentDue: null }))
      .toThrow('keeps its historical');
    expect(() => {
      void Reflect.apply(patchWorkflowStepMetadata, undefined, [completed, secondId, {
        dueAt: '2027-01-01T00:00:00.000Z',
      }]);
    }).toThrow('must not rewrite');
    expect(completed.snapshot.steps[secondId]?.completionOperations).toHaveLength(1);
  });
});
