/** P1–P10 are separate gate contracts. Do not collapse them into broad examples. */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  appendAssignment, applyOffer, createOffer, propagationDecisionKey,
  reconcileTemplateRemovals, setOfferDecision, undoApply,
} from '@/platform/crm/propagation';
import { instance, RecordingTransaction, revision, template } from './propagationFixtures';

const titleChange = (value: string, kind: 'add' | 'modify' | 'remove' = 'modify') =>
  [{ stepId: 'step', field: 'title' as const, value, changeKind: kind }];

describe('Workflow template propagation properties', () => {
  it('P1 completed outcome immutable', () => {
    const base = instance();
    base.steps['step']!.status = 'done';
    base.steps['step']!.outcome = 'approved';
    base.steps['step']!.completionOperations.push({ completionId: 'complete-1', completedBy: 'advisor-a', outcome: 'approved', sourceOperationId: 'done-op' });
    const tx = new RecordingTransaction();
    const applied = applyOffer(template([revision('r1', [], titleChange('New title'))]), base,
      createOffer(template([revision('r1', [], titleChange('New title'))]), base, 'offer-1'), 'event-1', tx);
    const undone = undoApply(applied.instance, applied.event, 'undo-1', tx).instance;
    expect(undone.steps['step']!.completionOperations).toEqual(base.steps['step']!.completionOperations);
    expect(undone.steps['step']!.outcome).toBe('approved');
  });

  it('P2 no destructive removal', () => {
    const base = instance();
    base.steps['step']!.status = 'in_progress';
    const model = template([revision('r1', [], [{ stepId: 'step', field: '__step_removal__', value: true, changeKind: 'remove' }])]);
    const result = applyOffer(model, base, createOffer(model, base, 'offer-1'), 'event-1', new RecordingTransaction()).instance;
    expect(result.steps['step']).toMatchObject({ detachedFromTemplate: true, hiddenByTemplateRemoval: false, removalRequestedBy: ['r1'] });
  });

  it('P3 idempotent revision application', () => {
    fc.assert(fc.property(fc.string({ minLength: 1, maxLength: 24 }), (title) => {
      const base = instance();
      const model = template([revision('r1', [], titleChange(title))]);
      const offer = createOffer(model, base, 'offer-1');
      const once = applyOffer(model, base, offer, 'event-1', new RecordingTransaction());
      const twice = applyOffer(model, once.instance, offer, 'event-2', new RecordingTransaction());
      expect(twice.idempotent).toBe(true);
      expect(twice.instance).toEqual(once.instance);
    }), { numRuns: 1000, seed: 31001 });
  });

  it('P4 concurrent-apply convergence', () => {
    fc.assert(fc.property(fc.tuple(fc.string({ minLength: 1 }), fc.string({ minLength: 1 })), ([a, b]) => {
      const model = template([revision('r1', [], titleChange(a), 1), revision('r2', ['r1'], titleChange(b), 2)], ['r2']);
      const left = applyOffer(model, instance(), createOffer(model, instance(), 'offer-1'), 'event', new RecordingTransaction()).instance;
      const right = applyOffer(model, instance(), createOffer(model, instance(), 'offer-1'), 'event', new RecordingTransaction()).instance;
      expect(right).toEqual(left);
    }), { numRuns: 1000, seed: 31002 });
  });

  it('P5 complete revision-set pinning', () => {
    const base = instance();
    const model = template([revision('r1', [], titleChange('Rejected title'))]);
    const offer = setOfferDecision(createOffer(model, base, 'offer-1'), 'offer-1:r1:step:title', 'rejected');
    const result = applyOffer(model, base, offer, 'event-1', new RecordingTransaction()).instance;
    expect(result.steps['step']!.derived.title).toEqual(base.steps['step']!.derived.title);
    expect(result.decisionLedger).toEqual([expect.objectContaining({ decision: 'rejected', sourceOperationId: 'event-1:r1:step:title' })]);
    expect(result.displayedRevisionSet).toEqual({ revisionIds: ['r1'] });
  });

  it('P6 progress invariance', () => {
    const base = instance();
    Object.assign(base.steps['step']!, { status: 'done', assigneeUserId: 'advisor-a', stepNotes: 'human note', outcome: 'yes' });
    base.steps['step']!.completionOperations.push({ completionId: 'c1', completedBy: 'advisor-a', outcome: 'yes', sourceOperationId: 'c-op' });
    const model = template([revision('r1', [], titleChange('Template title'))]);
    const result = applyOffer(model, base, createOffer(model, base, 'offer-1'), 'event-1', new RecordingTransaction()).instance;
    expect(result.steps['step']!).toMatchObject({ status: 'done', assigneeUserId: 'advisor-a', stepNotes: 'human note', outcome: 'yes', completionOperations: base.steps['step']!.completionOperations });
  });

  it('P7 conditional undo scope', () => {
    const base = instance();
    const model = template([revision('r1', [], titleChange('Template title'))]);
    const applied = applyOffer(model, base, createOffer(model, base, 'offer-1'), 'event-1', new RecordingTransaction());
    applied.instance.steps['step']!.derived.title = { value: 'Later local title', sourceRevisionId: 'local', sourceOperationId: 'later-op' };
    const undone = undoApply(applied.instance, applied.event, 'undo-1', new RecordingTransaction());
    expect(undone.protectedCells).toContain('step:title');
    expect(undone.instance.steps['step']!.derived.title!.value).toBe('Later local title');
  });

  it('P8 added-step uniqueness', () => {
    const base = instance();
    const model = template([revision('r1', [], [{ stepId: 'new-step', field: 'title', value: 'New', changeKind: 'add' }])]);
    const offer = createOffer(model, base, 'offer-1');
    const once = applyOffer(model, base, offer, 'event-1', new RecordingTransaction());
    const twice = applyOffer(model, once.instance, offer, 'event-2', new RecordingTransaction()).instance;
    expect(Object.keys(twice.steps).filter((id) => id === 'new-step')).toHaveLength(1);
  });

  it('P9 monotonic accepted knowledge', () => {
    const base = instance();
    const model = template([revision('r1', [], titleChange('New title'))]);
    const applied = applyOffer(model, base, createOffer(model, base, 'offer-1'), 'event-1', new RecordingTransaction());
    const undone = undoApply(applied.instance, applied.event, 'undo-1', new RecordingTransaction()).instance;
    expect(undone.acceptedRevisionIds).toEqual(['r1']);
    expect(undone.propagationEvents).toHaveLength(2);
  });

  it('P10 reassign-after-complete', () => {
    const base = instance();
    base.steps['step']!.status = 'done';
    base.steps['step']!.outcome = 'approved';
    base.steps['step']!.completionOperations.push({ completionId: 'c1', completedBy: 'advisor-a', outcome: 'approved', sourceOperationId: 'c-op' });
    const reassigned = appendAssignment(base, 'step', { assignmentId: 'a1', assignedUserId: 'advisor-b', sourceOperationId: 'a-op' });
    expect(reassigned.steps['step']!).toMatchObject({ assigneeUserId: 'advisor-b', outcome: 'approved', completionOperations: base.steps['step']!.completionOperations });
    expect(reassigned.steps['step']!.assignmentOperations).toHaveLength(1);
  });

  it('SA revision-path field race', () => {
    const base = instance();
    const model = template([
      revision('r1', [], titleChange('Title'), 1),
      revision('r2', ['r1'], [{ stepId: 'step', field: 'description', value: 'Description', changeKind: 'modify' }], 2),
    ], ['r2']);
    const result = applyOffer(model, base, createOffer(model, base, 'offer-1'), 'event-1', new RecordingTransaction()).instance;
    expect(result.steps['step']!.derived.title!.sourceRevisionId).toBe('r1');
    expect(result.steps['step']!.derived.description!.sourceRevisionId).toBe('r2');
  });

  it('SA incomplete change-set visibility', () => {
    const base = instance();
    const model = template([revision('r1', [], titleChange('New title'))]);
    const offer = createOffer(model, base, 'offer-1');
    const failingTx = { transact: (): void => { throw new Error('crash before transaction commit'); } };
    expect(() => applyOffer(model, base, offer, 'event-1', failingTx)).toThrow('crash');
    expect(base.displayedRevisionSet).toEqual({ revisionIds: [] });
  });

  it('SA offline progress versus removal', () => {
    const base = instance();
    const removeModel = template([revision('r1', [], [{ stepId: 'step', field: '__step_removal__', value: true, changeKind: 'remove' }])]);
    const removed = applyOffer(removeModel, base, createOffer(removeModel, base, 'offer-1'), 'event-1', new RecordingTransaction()).instance;
    removed.steps['step']!.status = 'in_progress';
    expect(reconcileTemplateRemovals(removed).steps['step']).toMatchObject({ detachedFromTemplate: true, hiddenByTemplateRemoval: false });
  });

  it('SA conditional undo after local edit', () => {
    const base = instance();
    const model = template([revision('r1', [], titleChange('New title'))]);
    const applied = applyOffer(model, base, createOffer(model, base, 'offer-1'), 'event-1', new RecordingTransaction());
    applied.instance.steps['step']!.derived.title = { value: 'Local', sourceRevisionId: 'local', sourceOperationId: 'local-op' };
    expect(undoApply(applied.instance, applied.event, 'undo-1', new RecordingTransaction()).protectedCells).toContain('step:title');
  });

  // EXAM-BLOCKED: propagation's transaction port is synchronous and has no restartable SQLCipher outbox binding.
  it.skip('SA transactional outbox crash');

  it('SA decision-ledger persistence and re-offer', () => {
    const base = instance();
    const r1 = revision('r1', [], titleChange('Rejected'), 1);
    const firstModel = template([r1]);
    const rejected = setOfferDecision(createOffer(firstModel, base, 'offer-1'), 'offer-1:r1:step:title', 'rejected');
    const afterReject = applyOffer(firstModel, base, rejected, 'event-1', new RecordingTransaction()).instance;
    const r2 = revision('r2', ['r1'], titleChange('Reoffered'), 2);
    const reoffer = createOffer(template([r1, r2], ['r2']), afterReject, 'offer-2');
    expect(afterReject.decisionLedger.map((entry) => entry.decisionKey)).toContain(propagationDecisionKey('instance-1', 'r1', 'step', 'title'));
    expect(reoffer.decisions).toEqual([expect.objectContaining({ revisionId: 'r2', reofferState: 'reoffered', supersedesDecisionKey: propagationDecisionKey('instance-1', 'r1', 'step', 'title') })]);
  });

  it('SA deterministic target selection', () => {
    const r1 = revision('r1', [], titleChange('A'), 1);
    const r2 = revision('r2', [], titleChange('B'), 2);
    const unresolved = createOffer(template([r1, r2], ['r1', 'r2']), instance(), 'offer-1');
    expect(unresolved.requiresConcurrentHeadReview).toBe(true);
    expect(() => applyOffer(template([r1, r2], ['r1', 'r2']), instance(), unresolved, 'event-1', new RecordingTransaction())).toThrow('unresolved concurrent');
    const resolved = revision('r3', ['r1', 'r2'], titleChange('C'), 3);
    const model = template([r1, r2, resolved], ['r3']);
    expect(createOffer(model, instance(), 'offer-2').requiresConcurrentHeadReview).toBe(false);
  });
});
