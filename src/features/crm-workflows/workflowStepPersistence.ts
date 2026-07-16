import type { EntityRef } from '@/platform/crm/types';
import type { LiveCrmRecord } from '@/platform/crm/liveRecords';
import type { LiveWorkflowInstance } from '@/features/crm-home/workflowLive';

export type WorkflowStepDocumentRef = Pick<EntityRef, 'kind' | 'id' | 'matterId' | 'label'> & {
  kind: 'document';
};

/** The only instance-step metadata an extension may replace. */
export interface WorkflowStepMetadataPatch {
  tagIds?: readonly string[];
  documentRefs?: readonly WorkflowStepDocumentRef[];
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

function cleanDocumentRefs(values: readonly WorkflowStepDocumentRef[]): WorkflowStepDocumentRef[] {
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
  if (patch.tagIds === undefined && patch.documentRefs === undefined) {
    throw new Error('A workflow step metadata patch cannot be empty.');
  }
  const next = structuredClone(instance);
  const step = next.snapshot.steps[stepId];
  if (!step) throw new Error('This workflow step no longer exists.');
  step.tagIds = storedTagIds(step.tagIds);
  step.documentRefs = storedDocumentRefs(step.documentRefs);
  if (patch.tagIds !== undefined) step.tagIds = cleanTagIds(patch.tagIds);
  if (patch.documentRefs !== undefined) step.documentRefs = cleanDocumentRefs(patch.documentRefs);
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
