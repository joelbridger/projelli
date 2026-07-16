import {
  createTemplate,
  reviseWorkflowTemplateDraft,
  startWorkflow,
  workflowRecords,
  type LiveWorkflowInstance,
  type LiveWorkflowTemplate,
  type WorkflowStepDraft,
} from '@/features/crm-home/workflowLive';
import type { LiveCrmRecord } from '@/platform/crm/liveRecords';
import { useLiveCrmRecords } from '@/platform/crm/useLiveCrmRecords';

export type WorkflowTemplateStatus = 'draft' | 'published';

export interface WorkflowTemplateStep {
  readonly id: string;
  readonly title: string;
  readonly position: number;
  readonly tagIds: readonly string[];
}

export interface WorkflowTemplateRecord {
  readonly id: string;
  readonly name: string;
  readonly status: WorkflowTemplateStatus;
  readonly tagIds: readonly string[];
  readonly steps: readonly WorkflowTemplateStep[];
}

export interface WorkflowInstanceRecord {
  readonly id: string;
  readonly templateId: string;
  readonly householdId: string;
  readonly householdLabel: string;
  readonly name: string;
  readonly steps: readonly Pick<WorkflowTemplateStep, 'id' | 'tagIds'>[];
}

export interface CreateWorkflowTemplateInput {
  name: string;
  tagIds?: readonly string[];
  steps: readonly { title: string; tagIds?: readonly string[] }[];
}

export interface UpdateWorkflowTemplateInput {
  name: string;
  tagIds: readonly string[];
  steps: readonly WorkflowTemplateStep[];
}

export interface StartWorkflowInput {
  id: string;
  label: string;
  matterId?: string;
}

export interface WorkflowTemplateStore {
  list(): Promise<readonly WorkflowTemplateRecord[]>;
  get(id: string): Promise<WorkflowTemplateRecord | undefined>;
  getInstance(id: string): Promise<WorkflowInstanceRecord | undefined>;
  create(input: CreateWorkflowTemplateInput): Promise<WorkflowTemplateRecord>;
  update(id: string, input: UpdateWorkflowTemplateInput): Promise<WorkflowTemplateRecord>;
  publish(id: string): Promise<WorkflowTemplateRecord>;
  start(templateId: string, household: StartWorkflowInput): Promise<WorkflowInstanceRecord>;
}

export type WorkflowTemplateErrorCode =
  | 'workspace_unavailable'
  | 'persistence_failed'
  | 'invalid_template'
  | 'template_not_found'
  | 'template_not_published'
  | 'invalid_household';

/** Typed consumer error; callers can branch on `code` without parsing text. */
export class WorkflowTemplateError extends Error {
  readonly code: WorkflowTemplateErrorCode;

  constructor(code: WorkflowTemplateErrorCode, message: string) {
    super(message);
    this.name = 'WorkflowTemplateError';
    this.code = code;
  }
}

type LiveWorkflowPort = Pick<
  ReturnType<typeof useLiveCrmRecords>,
  'records' | 'workspaceRoot' | 'error' | 'save' | 'reload'
>;

const cleanTagIds = (values: readonly string[]): string[] => {
  const candidates: readonly unknown[] = values;
  if (candidates.some((value) => typeof value !== 'string' || !value.trim() || value !== value.trim())) {
    throw new WorkflowTemplateError('invalid_template', 'Workflow tags must use stable non-empty IDs.');
  }
  const ids = candidates.map(String);
  if (new Set(ids).size !== ids.length) {
    throw new WorkflowTemplateError('invalid_template', 'Workflow tag IDs must not be duplicated.');
  }
  return ids;
};

const storedTagIds = (value: unknown): string[] => Array.isArray(value)
  ? [...new Set(value.filter((id): id is string => typeof id === 'string' && Boolean(id.trim())))]
  : [];

function cleanName(value: string): string {
  const name = value.trim();
  if (!name) throw new WorkflowTemplateError('invalid_template', 'A workflow name is required.');
  return name;
}

function requireAvailable(port: LiveWorkflowPort): void {
  if (!port.workspaceRoot) {
    throw new WorkflowTemplateError('workspace_unavailable', 'Open a workspace before saving a workflow.');
  }
  if (port.error) {
    throw new WorkflowTemplateError('persistence_failed', 'Workflows are unavailable until CRM records reload.');
  }
}

function templateStatus(template: LiveWorkflowTemplate): WorkflowTemplateStatus {
  // Templates written before the lifecycle doorway were already startable.
  return template.status === 'draft' ? 'draft' : 'published';
}

function toTemplateRecord(template: LiveWorkflowTemplate): WorkflowTemplateRecord {
  return {
    id: template.id,
    name: template.name,
    status: templateStatus(template),
    tagIds: storedTagIds(template.tagIds),
    steps: template.steps.map((step, position) => ({
      id: step.id,
      title: step.title,
      position,
      tagIds: storedTagIds(step.tagIds),
    })),
  };
}

function toInstanceRecord(instance: LiveWorkflowInstance): WorkflowInstanceRecord {
  const orderedSteps = Object.values(instance.snapshot.steps).sort((left, right) => {
    const leftOrder = typeof left.derived.order?.value === 'number' ? left.derived.order.value : 0;
    const rightOrder = typeof right.derived.order?.value === 'number' ? right.derived.order.value : 0;
    return leftOrder - rightOrder;
  });
  return {
    id: instance.id,
    templateId: instance.templateId,
    householdId: instance.householdId,
    householdLabel: instance.householdLabel,
    name: instance.name,
    steps: orderedSteps.map((step) => ({
      id: step.stepId,
      tagIds: storedTagIds(step.tagIds),
    })),
  };
}

function toDraftSteps(
  current: LiveWorkflowTemplate,
  input: UpdateWorkflowTemplateInput
): WorkflowStepDraft[] {
  if (!input.steps.length) {
    throw new WorkflowTemplateError('invalid_template', 'A workflow needs at least one step.');
  }
  const currentById = new Map(current.steps.map((step) => [step.id, step]));
  const ids = input.steps.map((step) => step.id);
  if (ids.some((id) => !id.trim()) || new Set(ids).size !== ids.length) {
    throw new WorkflowTemplateError('invalid_template', 'Workflow steps need unique stable IDs.');
  }
  return input.steps.map((step, position) => {
    if (step.position !== position) {
      throw new WorkflowTemplateError('invalid_template', 'Workflow step positions must be ordered.');
    }
    const previous = currentById.get(step.id);
    return {
      id: step.id,
      title: cleanName(step.title),
      role: previous?.role ?? 'Client service',
      dueOffset: position,
      required: previous?.required ?? true,
      outcomes: previous?.outcomes ?? [],
      tagIds: cleanTagIds(step.tagIds),
    };
  });
}

function createWorkflowTemplateStore(port: LiveWorkflowPort): WorkflowTemplateStore {
  let currentRecords = [...port.records];
  const parsed = () => workflowRecords(currentRecords);
  const findTemplate = (id: string): LiveWorkflowTemplate => {
    const template = parsed().templates.find((candidate) => candidate.id === id);
    if (!template) {
      throw new WorkflowTemplateError('template_not_found', 'That workflow template no longer exists.');
    }
    return template;
  };
  const saveAndReload = async <T extends LiveCrmRecord>(record: T): Promise<T> => {
    try {
      const saved = await port.save(record) as T;
      currentRecords = currentRecords.some((candidate) => candidate.id === saved.id)
        ? currentRecords.map((candidate) => candidate.id === saved.id ? saved : candidate)
        : [...currentRecords, saved];
      await port.reload();
      return saved;
    } catch (error: unknown) {
      if (error instanceof WorkflowTemplateError) throw error;
      throw new WorkflowTemplateError('persistence_failed', 'The workflow could not be saved.');
    }
  };

  return {
    list: () => Promise.resolve().then(() => {
      requireAvailable(port);
      return parsed().templates.map(toTemplateRecord);
    }),
    get: (id) => Promise.resolve().then(() => {
      requireAvailable(port);
      const template = parsed().templates.find((candidate) => candidate.id === id);
      return template ? toTemplateRecord(template) : undefined;
    }),
    getInstance: (id) => Promise.resolve().then(() => {
      requireAvailable(port);
      const instance = parsed().instances.find((candidate) => candidate.id === id);
      return instance ? toInstanceRecord(instance) : undefined;
    }),
    create: async (input) => {
      requireAvailable(port);
      if (!input.steps.length) {
        throw new WorkflowTemplateError('invalid_template', 'A workflow needs at least one step.');
      }
      const template = createTemplate(cleanName(input.name), input.steps.map((step) => cleanName(step.title)));
      const draft: LiveWorkflowTemplate = {
        ...template,
        status: 'draft',
        tagIds: cleanTagIds(input.tagIds ?? []),
        steps: template.steps.map((step, position) => ({
          ...step,
          tagIds: cleanTagIds(input.steps[position]?.tagIds ?? []),
        })),
      };
      return toTemplateRecord(await saveAndReload(draft));
    },
    update: async (id, input) => {
      requireAvailable(port);
      const current = findTemplate(id);
      const draft = reviseWorkflowTemplateDraft(current, {
        name: cleanName(input.name),
        tagIds: cleanTagIds(input.tagIds),
        steps: toDraftSteps(current, input),
      });
      return toTemplateRecord(await saveAndReload(draft));
    },
    publish: async (id) => {
      requireAvailable(port);
      const current = findTemplate(id);
      const published: LiveWorkflowTemplate = {
        ...current,
        status: 'published',
        updatedAt: new Date().toISOString(),
      };
      return toTemplateRecord(await saveAndReload(published));
    },
    start: async (templateId, household) => {
      requireAvailable(port);
      const template = findTemplate(templateId);
      if (templateStatus(template) !== 'published') {
        throw new WorkflowTemplateError(
          'template_not_published',
          'Publish this workflow template before starting it.'
        );
      }
      const id = household.id.trim();
      const label = household.label.trim();
      if (!id || !label) {
        throw new WorkflowTemplateError('invalid_household', 'Choose a household before starting a workflow.');
      }
      const instance = startWorkflow(template, {
        id,
        label,
        ...(household.matterId?.trim() ? { matterId: household.matterId.trim() } : {}),
      });
      return toInstanceRecord(await saveAndReload(instance));
    },
  };
}

/** Reactive adapter over the current canonical live-record snapshot. */
export function useWorkflowTemplateStore(): WorkflowTemplateStore {
  return createWorkflowTemplateStore(useLiveCrmRecords());
}
