import type { EntityRef } from '@/platform/crm/types';
import type { LiveCrmRecord } from '@/platform/crm/liveRecords';
import type {
  LiveWorkflowInstance,
  WorkflowCompletionValidation,
} from '@/features/crm-home/workflowLive';

export type WorkflowStepDocumentRef = Pick<EntityRef, 'kind' | 'id' | 'matterId' | 'label'> & {
  kind: 'document';
};

export type WorkflowDueBase = 'workflow_start' | 'predecessor_completion';
export type WorkflowDueDirection = 'before' | 'after';
export type WorkflowDueUnit = 'days' | 'weeks' | 'months';

export interface WorkflowStepDependentDueRule {
  base: WorkflowDueBase;
  direction: WorkflowDueDirection;
  offset: number;
  unit: WorkflowDueUnit;
  predecessorStepId?: string;
}

export interface WorkflowStepTimingState {
  sequential: boolean;
  rule?: WorkflowStepDependentDueRule;
  dueAt?: string;
  blockedByStepId?: string;
}

interface WorkflowDependentDueMetadata {
  version: 1 | 2;
  sequential: boolean;
  steps: Record<string, WorkflowStepDependentDueRule>;
  completed: Record<string, WorkflowStepTimingHistory>;
}

interface WorkflowStepTimingHistory {
  baseAt: string | null;
  dueAt: string | null;
}

const DEPENDENT_DUE_METADATA_KEY = 'workflowDependentDue';

/** The only instance-step metadata an extension may replace. */
export interface WorkflowStepMetadataPatch {
  tagIds?: readonly string[];
  documentRefs?: readonly WorkflowStepDocumentRef[];
  dependentDue?: WorkflowStepDependentDueRule | null;
  sequential?: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  const allowedKeys = new Set(allowed);
  return Object.keys(value).every((key) => allowedKeys.has(key));
}

function stepOrder(instance: LiveWorkflowInstance): string[] {
  return Object.values(instance.snapshot.steps).map((step) => step.stepId);
}

function cleanDependentDueRule(
  value: unknown,
  instance: LiveWorkflowInstance,
  stepId: string,
): WorkflowStepDependentDueRule {
  if (!isRecord(value) || !hasOnlyKeys(value, [
    'base',
    'direction',
    'offset',
    'unit',
    'predecessorStepId',
  ])) {
    throw new Error('Workflow dependency metadata is malformed or contains multiple predecessors.');
  }
  const { base, direction, offset, unit, predecessorStepId } = value;
  if (base !== 'workflow_start' && base !== 'predecessor_completion') {
    throw new Error('Workflow due dates need a valid base.');
  }
  if (direction !== 'before' && direction !== 'after') {
    throw new Error('Workflow due dates need a valid direction.');
  }
  if (!Number.isSafeInteger(offset) || Number(offset) < 0) {
    throw new Error('Workflow due-date offsets must be non-negative whole numbers.');
  }
  if (unit !== 'days' && unit !== 'weeks' && unit !== 'months') {
    throw new Error('Workflow due dates need a valid unit.');
  }

  const order = stepOrder(instance);
  const position = order.indexOf(stepId);
  if (position < 0) throw new Error('This workflow step no longer exists.');
  if (base === 'workflow_start') {
    if (predecessorStepId !== undefined) {
      throw new Error('A workflow-start due rule cannot also name a predecessor.');
    }
    return { base, direction, offset: Number(offset), unit };
  }

  if (typeof predecessorStepId !== 'string' || !predecessorStepId.trim()) {
    throw new Error('A previous-step due rule needs one stable predecessor ID.');
  }
  if (predecessorStepId === stepId) {
    throw new Error('A workflow step cannot depend on itself.');
  }
  if (!instance.snapshot.steps[predecessorStepId]) {
    throw new Error('The selected workflow predecessor no longer exists.');
  }
  if (position === 0 || order[position - 1] !== predecessorStepId) {
    throw new Error('A workflow step may depend only on the immediately previous saved step.');
  }
  return { base, direction, offset: Number(offset), unit, predecessorStepId };
}

function validateNoDependencyCycles(metadata: WorkflowDependentDueMetadata): void {
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (stepId: string): void => {
    if (visiting.has(stepId)) throw new Error('Workflow step dependencies must not contain a cycle.');
    if (visited.has(stepId)) return;
    visiting.add(stepId);
    const predecessorStepId = metadata.steps[stepId]?.predecessorStepId;
    if (predecessorStepId) visit(predecessorStepId);
    visiting.delete(stepId);
    visited.add(stepId);
  };
  Object.keys(metadata.steps).forEach(visit);
}

function validateNoRawDependencyCycles(steps: Record<string, unknown>): void {
  const predecessorByStep = new Map<string, string>();
  for (const [stepId, value] of Object.entries(steps)) {
    if (isRecord(value) && typeof value['predecessorStepId'] === 'string') {
      predecessorByStep.set(stepId, value['predecessorStepId']);
    }
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (stepId: string): void => {
    if (visiting.has(stepId)) throw new Error('Workflow step dependencies must not contain a cycle.');
    if (visited.has(stepId)) return;
    visiting.add(stepId);
    const predecessorStepId = predecessorByStep.get(stepId);
    if (predecessorStepId) visit(predecessorStepId);
    visiting.delete(stepId);
    visited.add(stepId);
  };
  [...predecessorByStep.keys()].forEach(visit);
}

function readDependentDueMetadata(instance: LiveWorkflowInstance): WorkflowDependentDueMetadata {
  const value: unknown = instance[DEPENDENT_DUE_METADATA_KEY];
  if (value === undefined) return { version: 2, sequential: false, steps: {}, completed: {} };
  if (!isRecord(value) || !hasOnlyKeys(value, ['version', 'sequential', 'steps', 'completed'])) {
    throw new Error('Workflow dependency metadata is malformed or duplicated.');
  }
  if (
    (value['version'] !== 1 && value['version'] !== 2) ||
    typeof value['sequential'] !== 'boolean' ||
    !isRecord(value['steps']) ||
    (value['version'] === 2 && !isRecord(value['completed']))
  ) {
    throw new Error('Workflow dependency metadata is malformed or duplicated.');
  }
  validateNoRawDependencyCycles(value['steps']);
  const steps: Record<string, WorkflowStepDependentDueRule> = {};
  for (const [stepId, rule] of Object.entries(value['steps'])) {
    if (!instance.snapshot.steps[stepId]) {
      throw new Error('Workflow dependency metadata names an unknown step.');
    }
    steps[stepId] = cleanDependentDueRule(rule, instance, stepId);
  }
  const completed: Record<string, WorkflowStepTimingHistory> = {};
  const storedCompleted = value['version'] === 2 ? value['completed'] : {};
  if (!isRecord(storedCompleted)) {
    throw new Error('Workflow dependency metadata is malformed or duplicated.');
  }
  for (const [stepId, history] of Object.entries(storedCompleted)) {
    if (!instance.snapshot.steps[stepId] || !steps[stepId] || !isRecord(history) ||
      !hasOnlyKeys(history, ['baseAt', 'dueAt']) ||
      (history['baseAt'] !== null && !validIso(history['baseAt'])) ||
      (history['dueAt'] !== null && !validIso(history['dueAt']))) {
      throw new Error('Workflow dependency completion history is malformed.');
    }
    completed[stepId] = {
      baseAt: history['baseAt'],
      dueAt: history['dueAt'],
    };
  }
  const metadata: WorkflowDependentDueMetadata = {
    version: value['version'],
    sequential: value['sequential'],
    steps,
    completed,
  };
  validateNoDependencyCycles(metadata);
  return metadata;
}

function validIso(value: unknown): value is string {
  return typeof value === 'string' && value.trim() === value && !Number.isNaN(Date.parse(value));
}

function completionTime(
  instance: LiveWorkflowInstance,
  stepId: string,
  preserveFirst: boolean,
): string | undefined {
  const operations = instance.snapshot.steps[stepId]?.completionOperations ?? [];
  const valid = operations.flatMap((operation) => validIso(operation.completedAt) ? [operation.completedAt] : []);
  return preserveFirst ? valid[0] : valid.at(-1);
}

function shiftMonths(date: Date, months: number): Date {
  const next = new Date(date.getTime());
  const day = next.getUTCDate();
  next.setUTCDate(1);
  next.setUTCMonth(next.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)).getUTCDate();
  next.setUTCDate(Math.min(day, lastDay));
  return next;
}

function dueAtFrom(baseAt: string | undefined, rule: WorkflowStepDependentDueRule): string | undefined {
  if (!baseAt || !validIso(baseAt)) return undefined;
  const direction = rule.direction === 'after' ? 1 : -1;
  const date = new Date(baseAt);
  if (rule.unit === 'months') return shiftMonths(date, direction * rule.offset).toISOString();
  const days = rule.unit === 'weeks' ? rule.offset * 7 : rule.offset;
  date.setUTCDate(date.getUTCDate() + direction * days);
  return date.toISOString();
}

/** Reads the durable rule and derives its current due time from canonical saved timestamps. */
export function readWorkflowStepTiming(
  instance: LiveWorkflowInstance,
  stepId: string,
): WorkflowStepTimingState {
  const step = instance.snapshot.steps[stepId];
  if (!step) throw new Error('This workflow step no longer exists.');
  const metadata = readDependentDueMetadata(instance);
  const rule = metadata.steps[stepId];
  const order = stepOrder(instance);
  const position = order.indexOf(stepId);
  const blockedByStepId = metadata.sequential
    ? order.slice(0, position).find((candidate) => instance.snapshot.steps[candidate]?.status !== 'done')
    : undefined;
  if (!rule) {
    return {
      sequential: metadata.sequential,
      ...(blockedByStepId ? { blockedByStepId } : {}),
    };
  }
  const frozen = metadata.completed[stepId];
  const baseAt = rule.base === 'workflow_start'
    ? (validIso(instance.createdAt) ? instance.createdAt : undefined)
    : completionTime(instance, rule.predecessorStepId ?? '', false);
  const dueAt = frozen ? frozen.dueAt ?? undefined : dueAtFrom(baseAt, rule);
  return {
    sequential: metadata.sequential,
    rule: structuredClone(rule),
    ...(dueAt ? { dueAt } : {}),
    ...(blockedByStepId ? { blockedByStepId } : {}),
  };
}

function cleanTagIds(values: readonly string[]): string[] {
  if (values.some((value) => !value.trim() || value !== value.trim())) {
    throw new Error('Workflow tags must use stable non-empty IDs.');
  }
  if (new Set(values).size !== values.length) {
    throw new Error('Workflow tag IDs must not be duplicated.');
  }
  return [...values];
}

function storedTagIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((id): id is string => typeof id === 'string' && Boolean(id.trim())))];
}

function storedDocumentRefs(value: unknown): WorkflowStepDocumentRef[] {
  if (!Array.isArray(value)) return [];
  const paths = new Set<string>();
  return value.flatMap((candidate) => {
    if (!candidate || typeof candidate !== 'object') return [];
    const ref = candidate as Record<string, unknown>;
    if (ref['kind'] !== 'document' || typeof ref['id'] !== 'string') return [];
    const path = ref['id'].replace(/\\/g, '/');
    const segments = path.split('/');
    if (!path.trim() || path.startsWith('/') || /^[a-zA-Z]:\//.test(path) || segments.includes('..') || segments.includes('.') || paths.has(path)) return [];
    paths.add(path);
    return [{
      kind: 'document' as const,
      id: path,
      ...(typeof ref['matterId'] === 'string' ? { matterId: ref['matterId'] } : {}),
      ...(typeof ref['label'] === 'string' ? { label: ref['label'] } : {}),
    }];
  });
}

function cleanDocumentRefs(
  values: readonly WorkflowStepDocumentRef[],
  targetMatterId: string
): WorkflowStepDocumentRef[] {
  const paths = new Set<string>();
  return values.map((value) => {
    const candidate: unknown = value;
    if (!candidate || typeof candidate !== 'object') {
      throw new Error('Workflow step document reference is malformed.');
    }
    const ref = candidate as Record<string, unknown>;
    const path = typeof ref['id'] === 'string' ? ref['id'].replace(/\\/g, '/') : '';
    const segments = path.split('/');
    if (
      ref['kind'] !== 'document' ||
      !path.trim() ||
      path !== path.trim() ||
      path.includes('//') ||
      path.startsWith('/') ||
      /^[a-zA-Z]:\//.test(path) ||
      segments.includes('..') ||
      segments.includes('.')
    ) {
      throw new Error('Workflow step document reference is malformed.');
    }
    if (ref['matterId'] !== undefined && typeof ref['matterId'] !== 'string') {
      throw new Error('Workflow step document reference is malformed.');
    }
    if (ref['label'] !== undefined && typeof ref['label'] !== 'string') {
      throw new Error('Workflow step document reference is malformed.');
    }
    if (paths.has(path)) {
      throw new Error('Workflow step document references must not be duplicated.');
    }
    if (
      typeof ref['matterId'] !== 'string' ||
      ref['matterId'].trim() !== targetMatterId
    ) {
      throw new Error('Workflow step documents must belong to the same client as the workflow.');
    }
    paths.add(path);
    return {
      kind: 'document',
      id: path,
      ...(typeof ref['matterId'] === 'string' ? { matterId: ref['matterId'] } : {}),
      ...(typeof ref['label'] === 'string' ? { label: ref['label'] } : {}),
    };
  });
}

function isSavedWorkflowInstance(value: unknown): value is LiveWorkflowInstance {
  return Boolean(value) && typeof value === 'object' &&
    (value as { kind?: unknown }).kind === 'crm_workflow_instance' &&
    Boolean((value as { snapshot?: unknown }).snapshot);
}

/**
 * Returns a validated immutable instance update. The caller persists the result
 * through its existing canonical `onSave` route; this helper never opens storage.
 */
export function patchWorkflowStepMetadata(
  instance: LiveWorkflowInstance,
  stepId: string,
  patch: WorkflowStepMetadataPatch
): LiveWorkflowInstance {
  const currentStep = instance.snapshot.steps[stepId];
  if (!currentStep) throw new Error('This workflow step no longer exists.');
  const patchValue: unknown = patch;
  if (!isRecord(patchValue) || !hasOnlyKeys(patchValue, [
    'tagIds',
    'documentRefs',
    'dependentDue',
    'sequential',
  ])) {
    throw new Error('Workflow step metadata patches must not rewrite due or completion history.');
  }
  if (
    patch.tagIds === undefined &&
    patch.documentRefs === undefined &&
    patch.dependentDue === undefined &&
    patch.sequential === undefined
  ) {
    throw new Error('A workflow step metadata patch cannot be empty.');
  }
  const currentDependentDue = readDependentDueMetadata(instance);
  if (patch.dependentDue !== undefined && currentStep.status === 'done') {
    throw new Error('A completed workflow step keeps its historical due and completion record.');
  }
  if (patch.sequential !== undefined && typeof patch.sequential !== 'boolean') {
    throw new Error('Workflow sequence enforcement must be on or off.');
  }
  const next = structuredClone(instance);
  const step = next.snapshot.steps[stepId];
  if (!step) throw new Error('This workflow step no longer exists.');
  step.tagIds = storedTagIds(step.tagIds);
  step.documentRefs = storedDocumentRefs(step.documentRefs);
  if (patch.tagIds !== undefined) step.tagIds = cleanTagIds(patch.tagIds);
  if (patch.documentRefs !== undefined) {
    const targetMatterId = instance.matterId?.trim() || instance.householdId;
    step.documentRefs = cleanDocumentRefs(patch.documentRefs, targetMatterId);
  }
  if (patch.dependentDue !== undefined || patch.sequential !== undefined) {
    const metadata: WorkflowDependentDueMetadata = {
      version: 2,
      sequential: patch.sequential ?? currentDependentDue.sequential,
      steps: structuredClone(currentDependentDue.steps),
      completed: structuredClone(currentDependentDue.completed),
    };
    if (patch.dependentDue === null) Reflect.deleteProperty(metadata.steps, stepId);
    else if (patch.dependentDue !== undefined) {
      metadata.steps[stepId] = cleanDependentDueRule(patch.dependentDue, instance, stepId);
    }
    validateNoDependencyCycles(metadata);
    next[DEPENDENT_DUE_METADATA_KEY] = metadata;
  }
  return next;
}

/** Workflows-owned adapter from the typed extension callback to its canonical save route. */
export async function saveWorkflowStepMetadata(
  instance: LiveWorkflowInstance,
  stepId: string,
  patch: WorkflowStepMetadataPatch,
  onSave: (record: LiveCrmRecord) => Promise<unknown>
): Promise<LiveWorkflowInstance> {
  const next = patchWorkflowStepMetadata(instance, stepId, patch);
  const saved = await onSave(next);
  return isSavedWorkflowInstance(saved) ? saved : next;
}

/** Shared fail-closed validator used by every canonical completion entry point. */
export function validateWorkflowDependentDueCompletion(request: {
  instance: LiveWorkflowInstance;
  stepId: string;
}): WorkflowCompletionValidation {
  try {
    const timing = readWorkflowStepTiming(request.instance, request.stepId);
    if (!timing.sequential || !timing.blockedByStepId) return { ok: true };
    const blockedTitle = request.instance.snapshot.steps[timing.blockedByStepId]?.titleSnapshot;
    return {
      ok: false,
      refusal: {
        code: 'workflow_dependency_incomplete',
        message: blockedTitle
          ? `Finish “${blockedTitle}” before completing this step.`
          : 'Finish the required earlier step before completing this step.',
      },
    };
  } catch {
    return {
      ok: false,
      refusal: {
        code: 'workflow_dependency_invalid',
        message: 'Review this workflow’s step timing rules before completing work.',
      },
    };
  }
}

/** Saves the displayed base/due pair into the same durable extension bag. */
export function freezeWorkflowDependentDueCompletion(
  completedInstance: LiveWorkflowInstance,
  stepId: string,
): LiveWorkflowInstance {
  const metadata = readDependentDueMetadata(completedInstance);
  const rule = metadata.steps[stepId];
  if (!rule || metadata.completed[stepId]) return completedInstance;
  const baseAt = rule.base === 'workflow_start'
    ? (validIso(completedInstance.createdAt) ? completedInstance.createdAt : undefined)
    : completionTime(completedInstance, rule.predecessorStepId ?? '', false);
  const dueAt = dueAtFrom(baseAt, rule);
  const next = structuredClone(completedInstance);
  next[DEPENDENT_DUE_METADATA_KEY] = {
    version: 2,
    sequential: metadata.sequential,
    steps: structuredClone(metadata.steps),
    completed: {
      ...structuredClone(metadata.completed),
      [stepId]: { baseAt: baseAt ?? null, dueAt: dueAt ?? null },
    },
  } satisfies WorkflowDependentDueMetadata;
  return next;
}
