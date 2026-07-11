import {
  applyOffer,
  createOffer,
  publishRevision,
  reconcileTemplateRemovals,
  setOfferDecision,
  undoApply,
} from '@/platform/crm/propagation';
import { UNTOUCHED, type PropagationEngineOffer, type PropagationTransactionPayload, type WorkflowInstanceSnapshot, type WorkflowTemplateSnapshot } from '@/platform/crm/types';
import type { LiveCrmRecord } from '@/platform/crm/liveRecords';

export type WorkflowStepDraft = { id: string; title: string; role: string; dueOffset: number; required: boolean };
export type LiveWorkflowTemplate = LiveCrmRecord & {
  kind: 'crm_workflow_template'; name: string; snapshot: WorkflowTemplateSnapshot; steps: WorkflowStepDraft[];
};
export type LiveWorkflowInstance = LiveCrmRecord & {
  kind: 'crm_workflow_instance'; templateId: string; householdId: string; householdLabel: string; name: string;
  snapshot: WorkflowInstanceSnapshot; lastApplyEventId?: string;
};
export type LiveWorkflowOffer = LiveCrmRecord & {
  kind: 'crm_workflow_offer'; templateId: string; householdLabel: string; revisionLabel: string; engineOffer: PropagationEngineOffer;
};

const now = () => new Date().toISOString();
const unique = (prefix: string) => `${prefix}-${String(Date.now())}-${Math.random().toString(36).slice(2, 7)}`;
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const fieldsFor = (step: WorkflowStepDraft, changeKind: 'add' | 'modify' = 'add') => [
  { stepId: step.id, field: 'title' as const, value: step.title, changeKind },
  { stepId: step.id, field: 'defaultAssigneeRole' as const, value: step.role, changeKind },
  { stepId: step.id, field: 'dueOffset' as const, value: step.dueOffset, changeKind },
  { stepId: step.id, field: 'required' as const, value: step.required, changeKind },
];

export function workflowRecords(records: readonly LiveCrmRecord[]) {
  return {
    templates: records.filter((record): record is LiveWorkflowTemplate => record.kind === 'crm_workflow_template' && typeof record.name === 'string' && Boolean(record.snapshot)),
    instances: records.filter((record): record is LiveWorkflowInstance => record.kind === 'crm_workflow_instance' && typeof record.templateId === 'string' && Boolean(record.snapshot)),
    offers: records.filter((record): record is LiveWorkflowOffer => record.kind === 'crm_workflow_offer' && typeof record.templateId === 'string' && Boolean(record.engineOffer)),
  };
}

export function createTemplate(name: string, titles: readonly string[]): LiveWorkflowTemplate {
  const templateId = unique('workflow-template');
  const steps = titles.map((title, index) => ({
    id: `${templateId}-step-${String(index + 1)}`,
    title: title.trim() || `Step ${String(index + 1)}`,
    role: index === 0 ? 'Operations' : index === 1 ? 'Advisor' : 'Client service',
    dueOffset: index,
    required: true,
  }));
  const rootRevisionId = `${templateId}-starting-steps`;
  return {
    id: templateId,
    kind: 'crm_workflow_template',
    matterId: 'firm_home',
    name: name.trim() || 'New workflow',
    steps,
    snapshot: {
      id: templateId,
      headRevisionIds: [rootRevisionId],
      revisions: {
        [rootRevisionId]: {
          revisionId: rootRevisionId,
          templateId,
          parentRevisionIds: [],
          issuedHlc: { wallMillis: Date.now(), logicalCounter: 0, actorId: 'local-advisor', operationId: unique('publish') },
          label: 'Starting steps',
          stepChanges: steps.flatMap((step) => fieldsFor(step)),
        },
      },
    },
  };
}

function captureTransaction() {
  let payload: PropagationTransactionPayload | null = null;
  return { transaction: { transact(next: PropagationTransactionPayload) { payload = next; } }, payload: () => payload };
}

export function startWorkflow(template: LiveWorkflowTemplate, household: { id: string; label: string }): LiveWorkflowInstance {
  const instanceId = unique('workflow-instance');
  const base: WorkflowInstanceSnapshot = { id: instanceId, acceptedRevisionIds: [], displayedRevisionSet: { revisionIds: [] }, steps: {}, decisionLedger: [], propagationEvents: [] };
  const offer = createOffer(template.snapshot, base, unique('workflow-start'));
  const capture = captureTransaction();
  const applied = applyOffer(template.snapshot, base, offer, unique('start'), capture.transaction);
  return {
    id: instanceId,
    kind: 'crm_workflow_instance',
    matterId: household.id,
    templateId: template.id,
    householdId: household.id,
    householdLabel: household.label,
    name: template.name,
    snapshot: applied.instance,
  };
}

export function completeWorkflowStep(instance: LiveWorkflowInstance, stepId: string): LiveWorkflowInstance {
  const next = clone(instance);
  const step = next.snapshot.steps[stepId];
  if (!step) throw new Error('This workflow step no longer exists.');
  if (!step.completionOperations.length) step.completionOperations.push({ completionId: unique('complete'), completedBy: 'local-advisor', completedAt: now(), sourceOperationId: unique('manual-complete') });
  step.status = 'done';
  return { ...next, snapshot: reconcileTemplateRemovals(next.snapshot) };
}

/** A person can tailor an open household workflow. This is deliberately a
 * later local operation, so conditional undo will leave that cell alone. */
export function renameWorkflowStepLocally(instance: LiveWorkflowInstance, stepId: string, title: string): LiveWorkflowInstance {
  const next = clone(instance);
  const step = next.snapshot.steps[stepId];
  if (!step) throw new Error('This workflow step no longer exists.');
  const sourceOperationId = unique('local-title');
  step.derived.title = { value: title.trim() || step.titleSnapshot, sourceRevisionId: 'local', sourceOperationId };
  step.titleSnapshot = String(step.derived.title.value);
  return { ...next, snapshot: reconcileTemplateRemovals(next.snapshot) };
}

export function publishTemplateUpdate(template: LiveWorkflowTemplate, title: string, addedTitle: string) {
  const changed = template.steps[0];
  if (!changed) throw new Error('A workflow needs at least one step.');
  const added: WorkflowStepDraft = { id: unique(`${template.id}-step`), title: addedTitle.trim() || 'New follow-up', role: 'Client service', dueOffset: template.steps.length, required: true };
  const revisionId = unique(`${template.id}-update`);
  const nextTitle = title.trim() || changed.title;
  const revision = {
    revisionId,
    templateId: template.id,
    parentRevisionIds: [...template.snapshot.headRevisionIds],
    issuedHlc: { wallMillis: Date.now(), logicalCounter: 0, actorId: 'local-advisor', operationId: unique('publish') },
    label: 'Workflow steps updated',
    stepChanges: [
      { stepId: changed.id, field: 'title' as const, value: nextTitle, changeKind: 'modify' as const },
      ...fieldsFor(added),
    ],
  };
  const snapshot = publishRevision(template.snapshot, revision);
  const nextTemplate: LiveWorkflowTemplate = { ...template, snapshot, steps: [{ ...changed, title: nextTitle }, ...template.steps.slice(1), added] };
  return { template: nextTemplate, revisionId, label: revision.label };
}

export function offerForInstance(template: LiveWorkflowTemplate, instance: LiveWorkflowInstance, revisionId: string, label: string): LiveWorkflowOffer {
  const engineOffer = createOffer(template.snapshot, instance.snapshot, unique('workflow-offer'), [revisionId]);
  // The instance already has the starting revision. The engine gives us the full
  // closure; the review queue must show only the newly published change-set.
  // A completed step is protected progress, not a reviewable template cell.
  engineOffer.decisions = engineOffer.decisions.filter((decision) =>
    decision.revisionId === revisionId && instance.snapshot.steps[decision.stepId]?.status !== 'done',
  );
  return { id: engineOffer.offerId, kind: 'crm_workflow_offer', matterId: instance.householdId, templateId: template.id, householdLabel: instance.householdLabel, revisionLabel: label, engineOffer };
}

export function decideOffer(offer: LiveWorkflowOffer, decisionId: string, decision: 'accepted' | 'rejected'): LiveWorkflowOffer {
  return { ...offer, engineOffer: setOfferDecision(offer.engineOffer, decisionId, decision) };
}

export function applyWorkflowOffer(template: LiveWorkflowTemplate, instance: LiveWorkflowInstance, offer: LiveWorkflowOffer) {
  const capture = captureTransaction();
  const result = applyOffer(template.snapshot, instance.snapshot, offer.engineOffer, unique('apply'), capture.transaction);
  return {
    instance: { ...instance, snapshot: result.instance, lastApplyEventId: result.event.eventId },
    offer: { ...offer, engineOffer: { ...offer.engineOffer, state: 'applied' as const } },
    payload: capture.payload(),
  };
}

export function undoWorkflowApply(instance: LiveWorkflowInstance) {
  const event = instance.lastApplyEventId ? instance.snapshot.propagationEvents.find((candidate) => candidate.eventId === instance.lastApplyEventId) : undefined;
  if (!event) return { instance, undoneCells: [], protectedCells: [] };
  const capture = captureTransaction();
  const result = undoApply(instance.snapshot, event, unique('undo'), capture.transaction);
  return { instance: { ...instance, snapshot: result.instance }, undoneCells: result.undoneCells, protectedCells: result.protectedCells, payload: capture.payload() };
}

export function stepValue(instance: LiveWorkflowInstance, stepId: string, field: string): unknown {
  return instance.snapshot.steps[stepId]?.derived[field as keyof typeof instance.snapshot.steps[string]['derived']]?.value;
}

export { UNTOUCHED };
