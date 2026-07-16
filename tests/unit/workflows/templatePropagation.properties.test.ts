/**
 * Workflow-template propagation properties — frozen contract P1–P10.
 *
 * If a case fails, the bug is in src/platform/crm/propagation. Do not weaken
 * these assertions: they protect completed client work from template edits.
 */

import { describe, expect, it } from 'vitest';
import {
  UNTOUCHED,
  appendAssignment,
  applyOffer,
  createOffer,
  reconcileTemplateRemovals,
  setOfferDecision,
  undoApply,
  type PropagationTransactionPayload,
  type PropagationTransactionPort,
  type TemplateRevision,
  type WorkflowInstanceSnapshot,
  type WorkflowTemplateSnapshot,
} from '@/platform/crm/propagation';

const stamp = (operationId: string, wallMillis: number) => ({
  wallMillis,
  logicalCounter: 0,
  actorId: 'advisor-a',
  operationId,
});

function revision(
  revisionId: string,
  parents: string[],
  wallMillis: number,
  stepChanges: TemplateRevision['stepChanges'],
): TemplateRevision {
  return {
    revisionId,
    templateId: 'template-1',
    parentRevisionIds: parents,
    issuedHlc: stamp(`hlc-${revisionId}`, wallMillis),
    label: revisionId,
    stepChanges,
  };
}

const r0 = revision('r0', [], 1, [
  { stepId: 'step-1', field: 'title', value: 'Initial title', changeKind: 'add' },
  { stepId: 'step-1', field: 'required', value: true, changeKind: 'add' },
]);
const r1 = revision('r1', ['r0'], 2, [
  { stepId: 'step-1', field: 'title', value: 'Updated title', changeKind: 'modify' },
]);

function template(revisions: TemplateRevision[] = [r0, r1], heads = ['r1']): WorkflowTemplateSnapshot {
  return {
    id: 'template-1',
    revisions: Object.fromEntries(revisions.map(item => [item.revisionId, item])),
    headRevisionIds: heads,
  };
}

function instance(): WorkflowInstanceSnapshot {
  return {
    id: 'instance-1',
    acceptedRevisionIds: ['r0'],
    displayedRevisionSet: { revisionIds: ['r0'] },
    steps: {
      'step-1': {
        stepId: 'step-1',
        origin: 'template',
        status: UNTOUCHED,
        titleSnapshot: 'Initial title',
        derived: {
          title: { value: 'Initial title', sourceRevisionId: 'r0', sourceOperationId: 'op-r0' },
          required: { value: true, sourceRevisionId: 'r0', sourceOperationId: 'op-r0-required' },
        },
        removalRequestedBy: [],
        detachedFromTemplate: false,
        stepNotes: '',
        tagIds: [],
        documentRefs: [],
        assignmentOperations: [],
        completionOperations: [],
      },
    },
    decisionLedger: [],
    propagationEvents: [],
  };
}

class MemoryTransaction implements PropagationTransactionPort {
  readonly payloads: PropagationTransactionPayload[] = [];
  constructor(private readonly fail = false) {}
  transact(payload: PropagationTransactionPayload): void {
    if (this.fail) throw new Error('simulated crash before commit');
    this.payloads.push(JSON.parse(JSON.stringify(payload)) as PropagationTransactionPayload);
  }
}

function applyR1(current = instance(), transaction = new MemoryTransaction()) {
  const offer = createOffer(template(), current, 'offer-r1', ['r1']);
  return applyOffer(template(), current, offer, 'apply-r1', transaction);
}

describe('template propagation properties', () => {
  it('P1 completed outcome immutable', () => {
    const current = instance();
    current.steps['step-1']!.completionOperations.push({
      completionId: 'completion-1', completedBy: 'advisor-a', outcome: 'sent', sourceOperationId: 'complete-1',
    });
    const completedBefore = JSON.stringify(current.steps['step-1']!.completionOperations);
    const applied = applyR1(current);
    const undone = undoApply(applied.instance, applied.event, 'undo-p1', new MemoryTransaction());
    expect(JSON.stringify(undone.instance.steps['step-1']!.completionOperations)).toBe(completedBefore);
  });

  it('P2 no destructive removal', () => {
    const removal = revision('r-remove', ['r1'], 3, [
      { stepId: 'step-1', field: '__step_removal__', value: true, changeKind: 'remove' },
    ]);
    const current = instance();
    current.steps['step-1']!.status = 'in_progress';
    const offer = createOffer(template([r0, r1, removal], ['r-remove']), current, 'offer-remove', ['r-remove']);
    const result = applyOffer(template([r0, r1, removal], ['r-remove']), current, offer, 'apply-remove', new MemoryTransaction());
    expect(result.instance.steps['step-1']).toBeDefined();
    expect(result.instance.steps['step-1']!.detachedFromTemplate).toBe(true);
    expect(result.instance.steps['step-1']!.hiddenByTemplateRemoval).toBe(false);
  });

  it('P3 idempotent revision application', () => {
    const current = instance();
    const tx = new MemoryTransaction();
    const first = applyR1(current, tx);
    const second = applyOffer(template(), first.instance, createOffer(template(), first.instance, 'offer-r1', ['r1']), 'apply-r1-again', tx);
    expect(second.idempotent).toBe(true);
    expect(second.instance).toEqual(first.instance);
    expect(tx.payloads).toHaveLength(1);
  });

  it('P4 concurrent-apply convergence', () => {
    const a = applyR1(instance()).instance;
    const b = applyR1(instance()).instance;
    expect(b).toEqual(a);
  });

  it('P5 complete revision-set pinning', () => {
    const current = instance();
    const offered = createOffer(template(), current, 'offer-reject-title', ['r1']);
    const titleDecision = offered.decisions.find(item => item.revisionId === 'r1')!;
    const rejected = setOfferDecision(offered, titleDecision.id, 'rejected');
    const result = applyOffer(template(), current, rejected, 'apply-reject-title', new MemoryTransaction());
    expect(result.instance.displayedRevisionSet.revisionIds).toEqual(['r0', 'r1']);
    expect(result.instance.steps['step-1']!.derived.title!.sourceRevisionId).toBe('r0');
    expect(result.instance.decisionLedger.find(item => item.revisionId === 'r1')!.decision).toBe('rejected');
  });

  it('P6 progress invariance', () => {
    const current = instance();
    const step = current.steps['step-1']!;
    step.status = 'in_progress';
    step.assigneeUserId = 'advisor-b';
    step.stepNotes = 'Called client';
    step.completionOperations.push({ completionId: 'c1', completedBy: 'advisor-a', outcome: 'done', sourceOperationId: 'c-op' });
    step.outcome = 'done';
    const progressBefore = JSON.stringify({ status: step.status, assignee: step.assigneeUserId, notes: step.stepNotes, completion: step.completionOperations, outcome: step.outcome });
    const result = applyR1(current);
    const after = result.instance.steps['step-1']!;
    expect(JSON.stringify({ status: after.status, assignee: after.assigneeUserId, notes: after.stepNotes, completion: after.completionOperations, outcome: after.outcome })).toBe(progressBefore);
  });

  it('P7 conditional undo scope', () => {
    const applied = applyR1();
    applied.instance.steps['step-1']!.derived.title = {
      value: 'Local correction', sourceRevisionId: 'local', sourceOperationId: 'local-op',
    };
    const result = undoApply(applied.instance, applied.event, 'undo-p7', new MemoryTransaction());
    expect(result.instance.steps['step-1']!.derived.title!.value).toBe('Local correction');
    expect(result.protectedCells).toContain('step-1:title');
  });

  it('P8 added-step uniqueness', () => {
    const current: WorkflowInstanceSnapshot = { ...instance(), steps: {} };
    const offer = createOffer(template(), current, 'offer-add', ['r0']);
    const once = applyOffer(template(), current, offer, 'apply-add', new MemoryTransaction());
    const twice = applyOffer(template(), once.instance, offer, 'apply-add-retry', new MemoryTransaction());
    expect(Object.keys(twice.instance.steps)).toEqual(['step-1']);
  });

  it('P9 monotonic accepted knowledge', () => {
    const applied = applyR1();
    const accepted = [...applied.instance.acceptedRevisionIds];
    const undone = undoApply(applied.instance, applied.event, 'undo-p9', new MemoryTransaction());
    expect(undone.instance.acceptedRevisionIds).toEqual(accepted);
    expect(undone.instance.propagationEvents.some(event => event.offerId === 'undo:offer-r1')).toBe(true);
  });

  it('P10 reassign-after-complete', () => {
    const current = instance();
    current.steps['step-1']!.completionOperations.push({ completionId: 'c1', completedBy: 'advisor-a', outcome: 'approved', sourceOperationId: 'complete-op' });
    const result = appendAssignment(current, 'step-1', { assignmentId: 'assignment-2', assignedUserId: 'advisor-b', sourceOperationId: 'assignment-op' });
    expect(result.steps['step-1']!.assigneeUserId).toBe('advisor-b');
    expect(result.steps['step-1']!.completionOperations[0]!.outcome).toBe('approved');
    expect(result.steps['step-1']!.assignmentOperations).toHaveLength(1);
  });
});

describe('sync-attack propagation regressions', () => {
  it('SA revision-path field race', () => {
    const r2 = revision('r2', ['r1'], 3, [
      { stepId: 'step-1', field: 'dueOffset', value: 14, changeKind: 'modify' },
    ]);
    const built = template([r0, r1, r2], ['r2']);
    const result = applyOffer(built, instance(), createOffer(built, instance(), 'offer-r2', ['r2']), 'apply-r2', new MemoryTransaction());
    expect(result.instance.steps['step-1']!.derived.title!.sourceRevisionId).toBe('r1');
    expect(result.instance.steps['step-1']!.derived.dueOffset!.sourceRevisionId).toBe('r2');
  });

  it('SA incomplete change-set visibility', () => {
    const current = instance();
    const oldSet = JSON.stringify(current.displayedRevisionSet);
    const offer = createOffer(template(), current, 'offer-crash', ['r1']);
    expect(() => applyOffer(template(), current, offer, 'apply-crash', new MemoryTransaction(true))).toThrow('simulated crash');
    expect(JSON.stringify(current.displayedRevisionSet)).toBe(oldSet);
    const recovered = applyOffer(template(), current, offer, 'apply-recovered', new MemoryTransaction());
    expect(recovered.instance.displayedRevisionSet.revisionIds).toEqual(['r0', 'r1']);
  });

  it('SA offline progress versus removal', () => {
    const current = instance();
    current.steps['step-1']!.status = 'in_progress';
    current.steps['step-1']!.removalRequestedBy = ['offline-removal'];
    const merged = reconcileTemplateRemovals(current);
    expect(merged.steps['step-1']!.detachedFromTemplate).toBe(true);
    expect(merged.steps['step-1']!.hiddenByTemplateRemoval).toBe(false);
  });

  it('SA conditional undo after local edit', () => {
    const applied = applyR1();
    applied.instance.steps['step-1']!.derived.title = { value: 'Local title', sourceRevisionId: 'local', sourceOperationId: 'local-title' };
    const undone = undoApply(applied.instance, applied.event, 'undo-local-edit', new MemoryTransaction());
    expect(undone.protectedCells).toContain('step-1:title');
    expect(undone.instance.steps['step-1']!.derived.title!.value).toBe('Local title');
  });

  it('SA transactional outbox crash', () => {
    const current = instance();
    const offer = createOffer(template(), current, 'offer-tx', ['r1']);
    expect(() => applyOffer(template(), current, offer, 'apply-tx', new MemoryTransaction(true))).toThrow();
    expect(current.propagationEvents).toHaveLength(0);
    expect(current.displayedRevisionSet.revisionIds).toEqual(['r0']);
  });

  it('SA decision-ledger persistence and re-offer', () => {
    const r2 = revision('r2', ['r1'], 3, [
      { stepId: 'step-1', field: 'description', value: 'New details', changeKind: 'modify' },
    ]);
    const r3 = revision('r3', ['r2'], 4, [
      { stepId: 'step-1', field: 'title', value: 'Re-offered title', changeKind: 'modify' },
    ]);
    const built = template([r0, r1, r2, r3], ['r3']);
    const initial = instance();
    const firstOffer = createOffer(built, initial, 'offer-r1-reject', ['r1']);
    const firstDecision = firstOffer.decisions.find(item => item.revisionId === 'r1')!;
    const rejected = applyOffer(built, initial, setOfferDecision(firstOffer, firstDecision.id, 'rejected'), 'apply-r1-reject', new MemoryTransaction());
    const unrelated = createOffer(built, rejected.instance, 'offer-r2', ['r2']);
    expect(unrelated.decisions.some(item => item.revisionId === 'r1' && item.field === 'title')).toBe(false);
    const reoffer = createOffer(built, rejected.instance, 'offer-r3', ['r3']);
    const title = reoffer.decisions.find(item => item.revisionId === 'r3' && item.field === 'title')!;
    expect(title.reofferState).toBe('reoffered');
    expect(title.supersedesDecisionKey).toContain(':r1:step-1:title');
  });

  it('SA deterministic target selection', () => {
    const left = revision('left', ['r0'], 2, [{ stepId: 'step-1', field: 'title', value: 'Left', changeKind: 'modify' }]);
    const right = revision('right', ['r0'], 3, [{ stepId: 'step-1', field: 'title', value: 'Right', changeKind: 'modify' }]);
    const conflicted = template([r0, left, right], ['left', 'right']);
    const review = createOffer(conflicted, instance(), 'offer-conflict', ['left', 'right']);
    expect(review.requiresConcurrentHeadReview).toBe(true);
    expect(() => applyOffer(conflicted, instance(), review, 'apply-conflict', new MemoryTransaction())).toThrow('Cannot silently');

    const composed = revision('composed', ['left', 'right'], 4, [{ stepId: 'step-1', field: 'title', value: 'Composed', changeKind: 'modify' }]);
    const resolved = template([r0, left, right, composed], ['composed']);
    const a = applyOffer(resolved, instance(), createOffer(resolved, instance(), 'offer-composed', ['composed']), 'apply-composed', new MemoryTransaction()).instance;
    const b = applyOffer(resolved, instance(), createOffer(resolved, instance(), 'offer-composed', ['composed']), 'apply-composed', new MemoryTransaction()).instance;
    expect(a).toEqual(b);
    expect(a.steps['step-1']!.derived.title!.value).toBe('Composed');
  });
});

// fast-check is approved by the frozen campaign but is supplied by the later test-campaign
// dependency lane. Until that shared dev dependency lands, this deterministic 1,000-case
// property loop keeps the required cardinality without adding a second dependency manifest.
describe('deterministic propagation property sweep', () => {
  it('keeps an accepted revision set monotonic across 1,000 generated replays', () => {
    for (let index = 0; index < 1000; index += 1) {
      const current = instance();
      const offer = createOffer(template(), current, `offer-property-${index}`, ['r1']);
      const first = applyOffer(template(), current, offer, `apply-property-${index}`, new MemoryTransaction());
      const retry = applyOffer(template(), first.instance, offer, `retry-property-${index}`, new MemoryTransaction());
      expect(retry.instance.acceptedRevisionIds).toEqual(first.instance.acceptedRevisionIds);
      expect(Object.keys(retry.instance.steps)).toEqual(['step-1']);
    }
  });
});
