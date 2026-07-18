import {
  applyOffer,
  createOffer,
  publishRevision,
  reconcileTemplateRemovals,
  setOfferDecision,
  undoApply,
} from '@/platform/crm/propagation';
import { UNTOUCHED, type EntityRef, type PropagationEngineOffer, type PropagationTransactionPayload, type TemplateStepChange, type WorkflowInstanceSnapshot, type WorkflowTemplateSnapshot } from '@/platform/crm/types';
import type { LiveCrmRecord } from '@/platform/crm/liveRecords';
import { registerWorkflowDependentDueCompletion } from '@/features/crm-workflows';

export type WorkflowStepOutcomeDraft = { id: string; label: string; nextStepId?: string | undefined; restartAtStepId?: string | undefined };
export type WorkflowStepDraft = { id: string; title: string; role: string; dueOffset: number; required: boolean; outcomes: WorkflowStepOutcomeDraft[]; tagIds: string[] };
export type WorkflowScheduleDraft = {
  frequency: 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'annual';
  timezone: string;
  startsAt: string;
  householdIds: string[];
  enabled: boolean;
};
export type LiveWorkflowTemplate = LiveCrmRecord & {
  kind: 'crm_workflow_template'; name: string; snapshot: WorkflowTemplateSnapshot; steps: WorkflowStepDraft[];
  status?: 'draft' | 'published'; tagIds?: string[];
  schedule?: WorkflowScheduleDraft; scheduledRunKeys?: string[];
};
export type LiveWorkflowInstance = LiveCrmRecord & {
  kind: 'crm_workflow_instance'; templateId: string; householdId: string; householdLabel: string; name: string;
  snapshot: WorkflowInstanceSnapshot; lastApplyEventId?: string; outcomesByStep?: Record<string, WorkflowStepOutcomeDraft[]>;
  scheduleRunKey?: string; status?: 'open' | 'completed' | 'cancelled';
};
export type LiveWorkflowOffer = LiveCrmRecord & {
  kind: 'crm_workflow_offer'; templateId: string; householdLabel: string; revisionLabel: string; engineOffer: PropagationEngineOffer;
};

export type WorkflowCompletionRefusal = {
  code: string;
  message: string;
};
export type WorkflowCompletionValidation =
  | { ok: true }
  | { ok: false; refusal: WorkflowCompletionRefusal };
export type WorkflowCompletionValidator = (request: {
  instance: LiveWorkflowInstance;
  stepId: string;
  outcomeId?: string;
}) => WorkflowCompletionValidation;

export class WorkflowCompletionRefusedError extends Error {
  readonly refusal: WorkflowCompletionRefusal;

  constructor(refusal: WorkflowCompletionRefusal) {
    super(refusal.message);
    this.name = 'WorkflowCompletionRefusedError';
    this.refusal = refusal;
  }
}

const workflowCompletionValidators: WorkflowCompletionValidator[] = [];

/** Registers an append-only completion preflight for every saved workflow step. */
export function registerWorkflowCompletionValidator(validator: WorkflowCompletionValidator): void {
  workflowCompletionValidators.push(validator);
}

const applyWorkflowDependentDueCompletion = registerWorkflowDependentDueCompletion(registerWorkflowCompletionValidator);

const now = () => new Date().toISOString();
const unique = (prefix: string) => `${prefix}-${String(Date.now())}-${Math.random().toString(36).slice(2, 7)}`;
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const storedTagIds = (value: unknown): string[] => Array.isArray(value)
  ? [...new Set(value.filter((id): id is string => typeof id === 'string' && Boolean(id.trim())))]
  : [];
const storedDocumentRefs = (value: unknown): Array<EntityRef & { kind: 'document' }> => {
  if (!Array.isArray(value)) return [];
  const paths = new Set<string>();
  return value.flatMap((candidate) => {
    if (!candidate || typeof candidate !== 'object') return [];
    const ref = candidate as Partial<EntityRef>;
    if (ref.kind !== 'document' || typeof ref.id !== 'string') return [];
    const path = ref.id.replace(/\\/g, '/');
    const segments = path.split('/');
    if (!path.trim() || path.startsWith('/') || /^[a-zA-Z]:\//.test(path) || segments.includes('..') || segments.includes('.') || paths.has(path)) return [];
    paths.add(path);
    return [{ ...ref, kind: 'document' as const, id: path }];
  });
};
const cleanTagIds = (values: readonly string[]): string[] => {
  const candidates: readonly unknown[] = values;
  if (candidates.some((value) => typeof value !== 'string' || !value.trim() || value !== value.trim())) throw new Error('Workflow tags must use stable non-empty IDs.');
  const ids = candidates.map(String);
  if (new Set(ids).size !== ids.length) throw new Error('Workflow tag IDs must not be duplicated.');
  return ids;
};
const cleanSteps = (steps: readonly WorkflowStepDraft[]): WorkflowStepDraft[] => {
  const ids = steps.map((step) => step.id);
  if (ids.some((id) => !id.trim()) || new Set(ids).size !== ids.length) throw new Error('Workflow steps need unique stable IDs.');
  return steps.map((step) => ({ ...step, outcomes: [...step.outcomes], tagIds: cleanTagIds(Array.isArray(step.tagIds) ? step.tagIds : []) }));
};
const fieldsFor = (step: WorkflowStepDraft, changeKind: 'add' | 'modify' = 'add') => [
  { stepId: step.id, field: 'title' as const, value: step.title, changeKind },
  { stepId: step.id, field: 'order' as const, value: step.dueOffset, changeKind },
  { stepId: step.id, field: 'defaultAssigneeRole' as const, value: step.role, changeKind },
  { stepId: step.id, field: 'dueOffset' as const, value: step.dueOffset, changeKind },
  { stepId: step.id, field: 'required' as const, value: step.required, changeKind },
];

export function workflowRecords(records: readonly LiveCrmRecord[]) {
  return {
    templates: records
      .filter((record): record is LiveWorkflowTemplate => record.kind === 'crm_workflow_template' && typeof record['name'] === 'string' && Boolean(record['snapshot']))
      .map((record) => ({
        ...record,
        steps: Array.isArray(record.steps)
          ? record.steps.map((step) => ({ ...step, tagIds: storedTagIds(step.tagIds) }))
          : [],
      })),
    instances: records
      .filter((record): record is LiveWorkflowInstance => record.kind === 'crm_workflow_instance' && typeof record['templateId'] === 'string' && Boolean(record['snapshot']))
      .map((record) => {
        const normalized = clone(record);
        for (const step of Object.values(normalized.snapshot.steps)) {
          step.tagIds = storedTagIds(step.tagIds);
          step.documentRefs = storedDocumentRefs(step.documentRefs);
        }
        return normalized;
      }),
    offers: records.filter((record): record is LiveWorkflowOffer => record.kind === 'crm_workflow_offer' && typeof record['templateId'] === 'string' && Boolean(record['engineOffer'])),
    meetings: records.filter((record) => record.kind === 'activityEvent' && typeof record['verb'] === 'string' && record['verb'].startsWith('meeting.')),
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
    outcomes: [],
    tagIds: [],
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

export function startWorkflow(
  template: LiveWorkflowTemplate,
  household: { id: string; label: string; matterId?: string },
  options?: { id?: string; scheduleRunKey?: string }
): LiveWorkflowInstance {
  const instanceId = options?.id ?? unique('workflow-instance');
  const base: WorkflowInstanceSnapshot = { id: instanceId, acceptedRevisionIds: [], displayedRevisionSet: { revisionIds: [] }, steps: {}, decisionLedger: [], propagationEvents: [] };
  const offer = createOffer(template.snapshot, base, unique('workflow-start'));
  const capture = captureTransaction();
  const applied = applyOffer(template.snapshot, base, offer, unique('start'), capture.transaction);
  const startedSnapshot = clone(applied.instance);
  for (const templateStep of template.steps) {
    const instanceStep = startedSnapshot.steps[templateStep.id];
    if (!instanceStep) continue;
    instanceStep.tagIds = cleanTagIds(Array.isArray(templateStep.tagIds) ? templateStep.tagIds : []);
    instanceStep.documentRefs = [];
  }
  return {
    id: instanceId,
    kind: 'crm_workflow_instance',
    matterId: household.matterId?.trim() || household.id,
    templateId: template.id,
    householdId: household.id,
    householdLabel: household.label,
    name: template.name,
    snapshot: startedSnapshot,
    outcomesByStep: Object.fromEntries(template.steps.map((step) => [step.id, step.outcomes])),
    ...(options?.scheduleRunKey ? { scheduleRunKey: options.scheduleRunKey } : {}),
    status: 'open',
  };
}

function completeWorkflowStep(instance: LiveWorkflowInstance, stepId: string, outcomeId?: string): LiveWorkflowInstance {
  const next = clone(instance);
  const step = next.snapshot.steps[stepId];
  if (!step) throw new Error('This workflow step no longer exists.');
  const outcome = outcomeId ? next.outcomesByStep?.[stepId]?.find((item) => item.id === outcomeId) : undefined;
  if (outcomeId && !outcome) throw new Error('This workflow outcome is no longer available.');
  if (!step.completionOperations.length) step.completionOperations.push({ completionId: unique('complete'), completedBy: 'local-advisor', completedAt: now(), ...(outcome ? { outcome: outcome.label } : {}), sourceOperationId: unique('manual-complete') });
  step.status = 'done';
  if (outcome) step.outcome = outcome.label;
  else delete step.outcome;
  const nextStepId = outcome?.nextStepId;
  const restartAtStepId = outcome?.restartAtStepId;
  if (nextStepId && next.snapshot.steps[nextStepId]) next.snapshot.steps[nextStepId].status = 'in_progress';
  if (restartAtStepId && next.snapshot.steps[restartAtStepId]) next.snapshot.steps[restartAtStepId].status = 'in_progress';
  const completed = Boolean(outcome && !outcome.nextStepId && !outcome.restartAtStepId);
  return { ...next, snapshot: reconcileTemplateRemovals(next.snapshot), ...(completed ? { status: 'completed' as const } : {}) };
}

export function applyWorkflowStepCompletion(
  instance: LiveWorkflowInstance,
  stepId: string,
  outcomeId?: string
): LiveWorkflowInstance {
  for (const validator of workflowCompletionValidators) {
    // A validator may inspect the whole workflow, but it must never receive the
    // live object that will be completed and saved. Give every validator its
    // own defensive snapshot so one validator cannot mutate either the caller
    // or the input observed by a later validator.
    const request = {
      instance: clone(instance),
      stepId,
      ...(outcomeId === undefined ? {} : { outcomeId }),
    };
    const result = validator(request);
    if (!result.ok) throw new WorkflowCompletionRefusedError(result.refusal);
  }
  return applyWorkflowDependentDueCompletion(instance, stepId, outcomeId, completeWorkflowStep);
}

export function addWorkflowStepNote(instance: LiveWorkflowInstance, stepId: string, note: string): LiveWorkflowInstance {
  const trimmed = note.trim();
  if (!trimmed) return instance;
  const next = clone(instance);
  const step = next.snapshot.steps[stepId];
  if (!step) throw new Error('This workflow step no longer exists.');
  const entry = `You · ${new Date().toLocaleString()}\n${trimmed}`;
  step.stepNotes = step.stepNotes ? `${step.stepNotes}\n\n${entry}` : entry;
  return { ...next, snapshot: reconcileTemplateRemovals(next.snapshot) };
}

export function updateWorkflowTemplate(template: LiveWorkflowTemplate, change: { schedule?: WorkflowScheduleDraft; outcomes?: Record<string, WorkflowStepOutcomeDraft[]>; steps?: readonly WorkflowStepDraft[] }): LiveWorkflowTemplate {
  const steps = change.steps ? cleanSteps(change.steps) : template.steps;
  if (change.steps) {
    const currentIds = new Set(template.steps.map((step) => step.id));
    const nextIds = new Set(steps.map((step) => step.id));
    if (
      currentIds.size !== nextIds.size ||
      [...currentIds].some((id) => !nextIds.has(id))
    ) {
      throw new Error('Workflow metadata edits must preserve stable step IDs.');
    }
  }
  return {
    ...template,
    ...(change.schedule ? { schedule: change.schedule } : {}),
    steps: change.outcomes
      ? steps.map((step) => ({ ...step, outcomes: change.outcomes?.[step.id] ?? step.outcomes }))
      : steps,
  };
}

/** Builds a canonical draft revision while retaining every supplied stable step ID. */
export function reviseWorkflowTemplateDraft(
  template: LiveWorkflowTemplate,
  change: { name: string; tagIds: readonly string[]; steps: readonly WorkflowStepDraft[] }
): LiveWorkflowTemplate {
  const steps = cleanSteps(change.steps);
  if (!steps.length) throw new Error('A workflow needs at least one step.');
  const previousById = new Map(template.steps.map((step) => [step.id, step]));
  const nextIds = new Set(steps.map((step) => step.id));
  const stepChanges: TemplateStepChange[] = template.steps
    .filter((step) => !nextIds.has(step.id))
    .map((step) => ({
      stepId: step.id,
      field: '__step_removal__' as const,
      value: true,
      changeKind: 'remove' as const,
    }));

  steps.forEach((step, position) => {
    const previous = previousById.get(step.id);
    if (!previous) {
      stepChanges.push(...fieldsFor(step));
      return;
    }
    const fields = [
      ['title', step.title, previous.title],
      ['order', position, template.steps.findIndex((candidate) => candidate.id === step.id)],
      ['defaultAssigneeRole', step.role, previous.role],
      ['dueOffset', step.dueOffset, previous.dueOffset],
      ['required', step.required, previous.required],
    ] as const;
    for (const [field, value, prior] of fields) {
      if (value !== prior) {
        stepChanges.push({ stepId: step.id, field, value, changeKind: 'modify' });
      }
    }
  });

  const snapshot = stepChanges.length
    ? publishRevision(template.snapshot, {
        revisionId: unique(`${template.id}-draft`),
        templateId: template.id,
        parentRevisionIds: [...template.snapshot.headRevisionIds],
        issuedHlc: {
          wallMillis: Date.now(),
          logicalCounter: 0,
          actorId: 'local-advisor',
          operationId: unique('draft'),
        },
        label: 'Workflow draft updated',
        stepChanges,
      })
    : template.snapshot;

  return {
    ...template,
    name: change.name,
    status: 'draft',
    tagIds: cleanTagIds(change.tagIds),
    steps,
    snapshot,
  };
}

function scheduledRunKey(schedule: WorkflowScheduleDraft, at: Date): string | null {
  const start = new Date(schedule.startsAt);
  if (Number.isNaN(start.getTime()) || start.getTime() > at.getTime()) return null;
  const year = at.getUTCFullYear();
  const month = at.getUTCMonth() + 1;
  if (schedule.frequency === 'daily') return `${String(year)}-${String(month).padStart(2, '0')}-${String(at.getUTCDate()).padStart(2, '0')}`;
  if (schedule.frequency === 'weekly') return `${String(year)}-w${String(Math.floor((Date.UTC(year, month - 1, at.getUTCDate()) - Date.UTC(year, 0, 1)) / 604800000))}`;
  if (schedule.frequency === 'monthly') return `${String(year)}-${String(month).padStart(2, '0')}`;
  if (schedule.frequency === 'quarterly') return `${String(year)}-q${String(Math.floor((month - 1) / 3) + 1)}`;
  return String(year);
}

/** Client-side scheduler: each device can safely make the same deterministic
 * instance record; the live record bridge upserts it rather than duplicating it. */
export function startScheduledWorkflows(template: LiveWorkflowTemplate, households: readonly { id: string; label: string; matterId?: string }[], at = new Date()) {
  const schedule = template.schedule;
  if (!schedule?.enabled) return { template, instances: [] as LiveWorkflowInstance[] };
  const runKey = scheduledRunKey(schedule, at);
  if (!runKey || (template.scheduledRunKeys ?? []).includes(runKey)) return { template, instances: [] as LiveWorkflowInstance[] };
  const selected = households.filter((household) => schedule.householdIds.includes(household.id));
  if (!selected.length) return { template, instances: [] as LiveWorkflowInstance[] };
  const instances = selected.map((household) => startWorkflow(template, household, { id: `scheduled-${template.id}-${household.id}-${runKey}`, scheduleRunKey: runKey }));
  return { template: { ...template, scheduledRunKeys: [...(template.scheduledRunKeys ?? []), runKey] }, instances };
}

export function createMeetingWorkflowProposal(
  meeting: LiveCrmRecord,
  template: LiveWorkflowTemplate,
  household: { id: string; label: string; matterId?: string }
): LiveCrmRecord {
  const summary = typeof meeting['summary'] === 'string' ? meeting['summary'] : 'Meeting follow-up';
  const householdMatterId = household.matterId?.trim() || household.id;
  return {
    id: unique('workflow-proposal'), kind: 'proposalRecord', matterId: 'firm_home', title: `Review proposed ${template.name} workflow`,
    householdRef: { kind: 'household', id: household.id, matterId: householdMatterId }, proposalKind: 'workflow_launch',
    proposedMutation: { kind: 'workflow_launch', workflowTemplateId: template.id },
    proposedBy: { userId: 'meeting-ai', display: 'Meeting assistant', kind: 'ai' },
    rationale: `Meeting notes suggest “${template.name}” may help: ${summary}`,
    contextRefs: [{ kind: 'activityEvent', id: meeting.id, ...(typeof meeting.matterId === 'string' ? { matterId: meeting.matterId } : {}) }],
    state: 'pending', source: { origin: 'meeting', sources: [] }, createdAt: now(), updatedAt: now(),
  };
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
  const changed = template.steps[1] ?? template.steps[0];
  if (!changed) throw new Error('A workflow needs at least one step.');
  const added: WorkflowStepDraft = { id: unique(`${template.id}-step`), title: addedTitle.trim() || 'New follow-up', role: 'Client service', dueOffset: template.steps.length, required: true, outcomes: [], tagIds: [] };
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
  const nextTemplate: LiveWorkflowTemplate = { ...template, snapshot, steps: [{ ...changed, title: nextTitle, tagIds: storedTagIds(changed.tagIds) }, ...template.steps.slice(1).map((step) => ({ ...step, tagIds: storedTagIds(step.tagIds) })), added] };
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
  return { id: engineOffer.offerId, kind: 'crm_workflow_offer', matterId: instance.matterId?.trim() || instance.householdId, templateId: template.id, householdLabel: instance.householdLabel, revisionLabel: label, engineOffer };
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
