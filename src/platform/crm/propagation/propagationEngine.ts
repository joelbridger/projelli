/* eslint-disable @typescript-eslint/no-non-null-assertion -- Revision graph checks establish these internal invariants before access. */
import {
  UNTOUCHED,
  type AssignmentOperation,
  type DerivedBeforeImage,
  type DerivedFieldName,
  type HlcStamp,
  type OfferDecision,
  type PropagationApplyEvent,
  type PropagationDecision,
  type PropagationOffer,
  type PropagationTransactionPort,
  type TemplateRevision,
  type TemplateStepChange,
  type WorkflowInstanceSnapshot,
  type WorkflowStepProgress,
  type WorkflowTemplateSnapshot,
} from './types';

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function compareHlcAndOperationId(left: HlcStamp, right: HlcStamp): number {
  const fields: Array<keyof HlcStamp> = ['wallMillis', 'logicalCounter', 'actorId', 'operationId'];
  for (const field of fields) {
    if (left[field] === right[field]) continue;
    return left[field] > right[field] ? 1 : -1;
  }
  return 0;
}

export function propagationDecisionKey(
  instanceId: string,
  revisionId: string,
  stepId: string,
  field: OfferDecision['field'],
): string {
  return `${instanceId}:${revisionId}:${stepId}:${field}`;
}

export function publishRevision(
  template: WorkflowTemplateSnapshot,
  revision: TemplateRevision,
): WorkflowTemplateSnapshot {
  if (revision.templateId !== template.id) throw new Error('Revision belongs to another template');
  if (template.revisions[revision.revisionId]) throw new Error('Revision IDs are immutable and cannot be reused');
  for (const parentId of revision.parentRevisionIds) {
    if (!template.revisions[parentId]) throw new Error(`Unknown parent revision: ${parentId}`);
  }

  const next = clone(template);
  next.revisions[revision.revisionId] = clone(revision);
  const consumedParents = new Set(revision.parentRevisionIds);
  next.headRevisionIds = [...new Set([
    ...next.headRevisionIds.filter(head => !consumedParents.has(head)),
    revision.revisionId,
  ])].sort();
  return next;
}

export function revisionClosure(
  template: WorkflowTemplateSnapshot,
  targetRevisionIds: string[],
): TemplateRevision[] {
  const included = new Set<string>();
  const visit = (revisionId: string): void => {
    if (included.has(revisionId)) return;
    const revision = template.revisions[revisionId];
    if (!revision) throw new Error(`Unknown revision: ${revisionId}`);
    included.add(revisionId);
    revision.parentRevisionIds.forEach(visit);
  };
  targetRevisionIds.forEach(visit);

  const ordered: TemplateRevision[] = [];
  const pending = new Set(included);
  while (pending.size) {
    const ready = [...pending]
      .map(id => template.revisions[id]!)
      .filter(revision => revision.parentRevisionIds.every(parent => !pending.has(parent)))
      .sort((a, b) => compareHlcAndOperationId(a.issuedHlc, b.issuedHlc)
        || a.revisionId.localeCompare(b.revisionId));
    if (!ready.length) throw new Error('Revision graph contains a cycle');
    for (const revision of ready) {
      ordered.push(revision);
      pending.delete(revision.revisionId);
    }
  }
  return ordered;
}

function isDescendant(template: WorkflowTemplateSnapshot, revisionId: string, ancestorId: string): boolean {
  if (revisionId === ancestorId) return false;
  return revisionClosure(template, [revisionId]).some(revision => revision.revisionId === ancestorId);
}

function changesFor(template: WorkflowTemplateSnapshot, targetRevisionIds: string[]): Array<TemplateStepChange & { revisionId: string }> {
  return revisionClosure(template, targetRevisionIds).flatMap(revision =>
    revision.stepChanges.map(change => ({ ...change, revisionId: revision.revisionId })),
  );
}

function unresolvedConcurrentFieldKeys(
  template: WorkflowTemplateSnapshot,
  changes: Array<TemplateStepChange & { revisionId: string }>,
): Set<string> {
  const unresolved = new Set<string>();
  const byField = new Map<string, Array<TemplateStepChange & { revisionId: string }>>();
  for (const change of changes) {
    const key = `${change.stepId}:${change.field}`;
    byField.set(key, [...(byField.get(key) ?? []), change]);
  }
  for (const [key, candidates] of byField) {
    for (let index = 0; index < candidates.length; index += 1) {
      for (let other = index + 1; other < candidates.length; other += 1) {
        const a = candidates[index]!;
        const b = candidates[other]!;
        const concurrent = !isDescendant(template, a.revisionId, b.revisionId)
          && !isDescendant(template, b.revisionId, a.revisionId);
        const hasComposedResolution = candidates.some(candidate =>
          isDescendant(template, candidate.revisionId, a.revisionId)
          && isDescendant(template, candidate.revisionId, b.revisionId),
        );
        if (concurrent && !hasComposedResolution && JSON.stringify(a.value) !== JSON.stringify(b.value)) {
          unresolved.add(key);
        }
      }
    }
  }
  return unresolved;
}

function priorRejectedDecision(
  instance: WorkflowInstanceSnapshot,
  stepId: string,
  field: OfferDecision['field'],
): PropagationDecision | undefined {
  return [...instance.decisionLedger].reverse().find(entry =>
    entry.stepId === stepId && entry.field === field && entry.decision === 'rejected',
  );
}

export function createOffer(
  template: WorkflowTemplateSnapshot,
  instance: WorkflowInstanceSnapshot,
  offerId: string,
  targetRevisionIds = template.headRevisionIds,
): PropagationOffer {
  const closure = revisionClosure(template, targetRevisionIds);
  const changes = changesFor(template, targetRevisionIds);
  const unresolved = unresolvedConcurrentFieldKeys(template, changes);
  const decisions: OfferDecision[] = [];

  for (const change of changes) {
    const priorRejected = priorRejectedDecision(instance, change.stepId, change.field);
    if (priorRejected && !isDescendant(template, change.revisionId, priorRejected.revisionId)) continue;
    const reoffered = Boolean(priorRejected);
    decisions.push({
      id: `${offerId}:${change.revisionId}:${change.stepId}:${change.field}`,
      revisionId: change.revisionId,
      stepId: change.stepId,
      field: change.field,
      value: clone(change.value),
      changeKind: change.changeKind,
      decision: unresolved.has(`${change.stepId}:${change.field}`) ? 'review_required' : 'accepted',
      supersedesDecisionKey: reoffered ? priorRejected!.decisionKey : undefined,
      reofferState: reoffered ? 'reoffered' : 'original',
    });
  }

  return {
    offerId,
    instanceId: instance.id,
    fromRevisionSet: clone(instance.displayedRevisionSet),
    targetRevisionSet: { revisionIds: closure.map(revision => revision.revisionId) },
    decisions,
    state: 'pending',
    requiresConcurrentHeadReview: decisions.some(decision => decision.decision === 'review_required'),
  };
}

export function setOfferDecision(
  offer: PropagationOffer,
  decisionId: string,
  decision: 'accepted' | 'rejected',
): PropagationOffer {
  const next = clone(offer);
  const found = next.decisions.find(item => item.id === decisionId);
  if (!found) throw new Error(`Unknown offer decision: ${decisionId}`);
  if (found.decision === 'review_required') throw new Error('Concurrent heads require an explicit composed revision');
  found.decision = decision;
  return next;
}

function sourceOperationId(eventId: string, decision: OfferDecision): string {
  return `${eventId}:${decision.revisionId}:${decision.stepId}:${decision.field}`;
}

function untouched(step: WorkflowStepProgress): boolean {
  return step.status === UNTOUCHED
    && step.stepNotes.length === 0
    && step.assignmentOperations.length === 0
    && step.completionOperations.length === 0
    && step.outcome === undefined;
}

/** Re-run after every merged state, including remote progress arriving after a removal. */
export function reconcileTemplateRemovals(instance: WorkflowInstanceSnapshot): WorkflowInstanceSnapshot {
  const next = clone(instance);
  for (const step of Object.values(next.steps)) {
    if (step.origin !== 'template' || !step.removalRequestedBy.length) continue;
    const canHide = untouched(step);
    step.hiddenByTemplateRemoval = canHide;
    step.detachedFromTemplate = !canHide;
  }
  return next;
}

function winningAcceptedChanges(
  template: WorkflowTemplateSnapshot,
  offer: PropagationOffer,
): OfferDecision[] {
  const revisions = new Map(revisionClosure(template, offer.targetRevisionSet.revisionIds)
    .map(revision => [revision.revisionId, revision]));
  const winners = new Map<string, OfferDecision>();
  for (const decision of offer.decisions.filter(item => item.decision === 'accepted')) {
    const key = `${decision.stepId}:${decision.field}`;
    const current = winners.get(key);
    if (!current) {
      winners.set(key, decision);
      continue;
    }
    const left = revisions.get(current.revisionId)!;
    const right = revisions.get(decision.revisionId)!;
    if (compareHlcAndOperationId(right.issuedHlc, left.issuedHlc) > 0) winners.set(key, decision);
  }
  return [...winners.values()];
}

function appendLedger(
  next: WorkflowInstanceSnapshot,
  offer: PropagationOffer,
  eventId: string,
): void {
  for (const decision of offer.decisions) {
    if (decision.decision === 'review_required') {
      throw new Error('Cannot persist an unresolved concurrent-head decision');
    }
    const decisionKey = propagationDecisionKey(next.id, decision.revisionId, decision.stepId, decision.field);
    if (next.decisionLedger.some(entry => entry.decisionKey === decisionKey)) continue;
    next.decisionLedger.push({
      decisionKey,
      instanceId: next.id,
      revisionId: decision.revisionId,
      stepId: decision.stepId,
      field: decision.field,
      decision: decision.decision,
      sourceOperationId: sourceOperationId(eventId, decision),
      supersedesDecisionKey: decision.supersedesDecisionKey,
      reofferState: decision.reofferState,
    });
  }
}

function newTemplateStep(stepId: string): WorkflowStepProgress {
  return {
    stepId,
    origin: 'template',
    status: UNTOUCHED,
    titleSnapshot: '',
    derived: {},
    removalRequestedBy: [],
    detachedFromTemplate: false,
    stepNotes: '',
    assignmentOperations: [],
    completionOperations: [],
  };
}

export interface ApplyResult {
  instance: WorkflowInstanceSnapshot;
  event: PropagationApplyEvent;
  idempotent: boolean;
}

/**
 * Applies the composed offer through one B1 transaction.  The caller's instance changes
 * only after the transaction accepts the whole CRDT/event/operation/outbox bundle.
 */
export function applyOffer(
  template: WorkflowTemplateSnapshot,
  instance: WorkflowInstanceSnapshot,
  offer: PropagationOffer,
  eventId: string,
  transaction: PropagationTransactionPort,
): ApplyResult {
  if (offer.instanceId !== instance.id) throw new Error('Offer belongs to another instance');
  if (offer.state === 'applied' || instance.propagationEvents.some(event => event.offerId === offer.offerId)) {
    return { instance: clone(instance), event: instance.propagationEvents.find(event => event.offerId === offer.offerId)!, idempotent: true };
  }
  if (offer.requiresConcurrentHeadReview || offer.decisions.some(item => item.decision === 'review_required')) {
    throw new Error('Cannot silently apply unresolved concurrent revision heads');
  }

  const next = clone(instance);
  const beforeImages: DerivedBeforeImage[] = [];
  const addedStepIds: string[] = [];
  const winners = winningAcceptedChanges(template, offer);
  for (const decision of winners) {
    if (decision.changeKind === 'remove') {
      const existing = next.steps[decision.stepId];
      if (existing) existing.removalRequestedBy = [...new Set([...existing.removalRequestedBy, decision.revisionId])].sort();
      continue;
    }
    let step = next.steps[decision.stepId];
    if (!step) {
      step = newTemplateStep(decision.stepId);
      next.steps[decision.stepId] = step;
      addedStepIds.push(decision.stepId);
    }
    if (step.origin !== 'template') continue;
    const field = decision.field as DerivedFieldName;
    const operationId = sourceOperationId(eventId, decision);
    beforeImages.push({ stepId: step.stepId, field, previous: step.derived[field] ? clone(step.derived[field]) : undefined, sourceOperationId: operationId });
    step.derived[field] = { value: clone(decision.value), sourceRevisionId: decision.revisionId, sourceOperationId: operationId };
    if (field === 'title') step.titleSnapshot = String(decision.value);
  }

  appendLedger(next, offer, eventId);
  next.acceptedRevisionIds = [...new Set([...next.acceptedRevisionIds, ...offer.targetRevisionSet.revisionIds])].sort();
  next.displayedRevisionSet = clone(offer.targetRevisionSet);
  const event: PropagationApplyEvent = {
    eventId,
    offerId: offer.offerId,
    operationIds: beforeImages.map(image => image.sourceOperationId),
    beforeImages,
    addedStepIds,
  };
  next.propagationEvents.push(event);
  const reconciled = reconcileTemplateRemovals(next);
  transaction.transact({
    kind: 'apply',
    instance: reconciled,
    event,
    immutableOperations: event.operationIds,
    activityOutbox: { eventId, idempotencyKey: `activity:${eventId}` },
    notificationOutbox: { eventId, idempotencyKey: `notify:${eventId}`, dependsOnOperationIds: event.operationIds },
  });
  return { instance: reconciled, event, idempotent: false };
}

export interface UndoResult {
  instance: WorkflowInstanceSnapshot;
  undoneCells: string[];
  protectedCells: string[];
}

/** Conditional undo is a compensating transaction; it never rewrites revision history. */
export function undoApply(
  instance: WorkflowInstanceSnapshot,
  event: PropagationApplyEvent,
  undoEventId: string,
  transaction: PropagationTransactionPort,
): UndoResult {
  const next = clone(instance);
  const undoneCells: string[] = [];
  const protectedCells: string[] = [];
  for (const image of event.beforeImages) {
    const step = next.steps[image.stepId];
    const label = `${image.stepId}:${image.field}`;
    if (!step || step.derived[image.field]?.sourceOperationId !== image.sourceOperationId) {
      protectedCells.push(label);
      continue;
    }
    if (image.previous) step.derived[image.field] = clone(image.previous);
    else Reflect.deleteProperty(step.derived, image.field);
    if (image.field === 'title') {
      const previousValue = image.previous?.value;
      step.titleSnapshot = previousValue === undefined || previousValue === null
        ? ''
        : String(previousValue as never);
    }
    undoneCells.push(label);
  }
  for (const stepId of event.addedStepIds) {
    const step = next.steps[stepId];
    if (!step) continue;
    const ownsAllDerivedCells = Object.values(step.derived).every(cell => event.operationIds.includes(cell.sourceOperationId));
    if (untouched(step) && ownsAllDerivedCells) {
      Reflect.deleteProperty(next.steps, stepId);
      undoneCells.push(`${stepId}:added-step`);
    } else {
      protectedCells.push(`${stepId}:added-step`);
    }
  }
  const compensatingEvent: PropagationApplyEvent = {
    eventId: undoEventId,
    offerId: `undo:${event.offerId}`,
    operationIds: [],
    beforeImages: [],
    addedStepIds: [],
  };
  next.propagationEvents.push(compensatingEvent);
  const reconciled = reconcileTemplateRemovals(next);
  transaction.transact({
    kind: 'undo',
    instance: reconciled,
    event: compensatingEvent,
    immutableOperations: [],
    activityOutbox: { eventId: undoEventId, idempotencyKey: `activity:${undoEventId}` },
    notificationOutbox: { eventId: undoEventId, idempotencyKey: `notify:${undoEventId}`, dependsOnOperationIds: [] },
  });
  return { instance: reconciled, undoneCells, protectedCells };
}

/** Assignment changes remain append-only operations owned by the CRM core. */
export function appendAssignment(
  instance: WorkflowInstanceSnapshot,
  stepId: string,
  assignment: AssignmentOperation,
): WorkflowInstanceSnapshot {
  const next = clone(instance);
  const step = next.steps[stepId];
  if (!step) throw new Error(`Unknown step: ${stepId}`);
  if (!step.assignmentOperations.some(item => item.assignmentId === assignment.assignmentId)) {
    step.assignmentOperations.push(clone(assignment));
  }
  if (assignment.assignedUserId === null) delete step.assigneeUserId;
  else step.assigneeUserId = assignment.assignedUserId;
  return reconcileTemplateRemovals(next);
}
