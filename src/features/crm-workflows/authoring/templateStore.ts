import type { FirmTagCatalog } from '@/features/crm-tags';
import type { LiveCrmRecord } from '@/platform/crm/liveRecords';
import {
  WorkflowAuthoringError,
  type CreateWorkflowAuthoringTemplateInput,
  type UpdateWorkflowAuthoringTemplateInput,
  type WorkflowAuthoringStart,
  type WorkflowAuthoringStep,
  type WorkflowAuthoringStore,
  type WorkflowAuthoringTemplate,
} from './contract';

export interface LiveWorkflowAuthoringPort {
  readonly records: readonly LiveCrmRecord[];
  readonly workspaceRoot: string | null | undefined;
  readonly error: string | null;
  save(record: LiveCrmRecord): Promise<LiveCrmRecord>;
  reload(): Promise<void>;
}

type TemplateRecord = LiveCrmRecord & {
  kind: 'workflow_authoring_template';
  title: string;
  authoringStatus: 'draft' | 'published';
  tagIds: readonly string[];
  steps: readonly WorkflowAuthoringStep[];
};

function isTemplateRecord(record: LiveCrmRecord): record is TemplateRecord {
  return (
    record.kind === 'workflow_authoring_template' &&
    typeof record['title'] === 'string' &&
    (record['authoringStatus'] === 'draft' ||
      record['authoringStatus'] === 'published') &&
    Array.isArray(record['tagIds']) &&
    Array.isArray(record['steps'])
  );
}

function uniqueIds(ids: readonly string[]): string[] {
  return [...new Set(ids.filter((id) => typeof id === 'string' && id.trim()))];
}

function templateFrom(record: TemplateRecord): WorkflowAuthoringTemplate {
  return {
    id: record.id,
    title: record.title,
    status: record.authoringStatus,
    tagIds: uniqueIds(record.tagIds),
    steps: record.steps
      .map((step) => ({ ...step, tagIds: uniqueIds(step.tagIds) }))
      .sort((left, right) => left.position - right.position),
  };
}

function newId(prefix: string): string {
  return `${prefix}:${crypto.randomUUID()}`;
}

function cleanTitle(value: string): string {
  const title = value.trim().replace(/\s+/g, ' ');
  if (!title || title.length > 120)
    throw new WorkflowAuthoringError('invalid_template');
  return title;
}

function validStep(
  step: WorkflowAuthoringStep,
  position: number
): WorkflowAuthoringStep {
  if (!step.id.trim() || step.position !== position) {
    throw new WorkflowAuthoringError('invalid_template');
  }
  return {
    ...step,
    title: cleanTitle(step.title),
    position,
    tagIds: uniqueIds(step.tagIds),
  };
}

function validateTags(
  tagIds: readonly string[],
  catalog: FirmTagCatalog,
  retainedIds: readonly string[] = []
): string[] {
  const retained = new Set(retainedIds);
  const tags = new Map(catalog.tags.map((tag) => [tag.id, tag]));
  const next = uniqueIds(tagIds);
  for (const id of next) {
    const tag = tags.get(id);
    if (!tag || (tag.status === 'retired' && !retained.has(id))) {
      throw new WorkflowAuthoringError('invalid_tag');
    }
  }
  return next;
}

function availability(port: LiveWorkflowAuthoringPort): void {
  if (!port.workspaceRoot)
    throw new WorkflowAuthoringError('workspace_unavailable');
  if (port.error) throw new WorkflowAuthoringError('persistence_failed');
}

async function saveAndReload(
  port: LiveWorkflowAuthoringPort,
  record: LiveCrmRecord
): Promise<void> {
  try {
    await port.save(record);
    await port.reload();
  } catch {
    throw new WorkflowAuthoringError('persistence_failed');
  }
}

/**
 * Canonical live-record adapter. It has no browser cache: each mutation saves
 * and reloads through the CRM path, so another adapter observes durable data.
 */
export function createWorkflowAuthoringStore(
  port: LiveWorkflowAuthoringPort,
  catalog: FirmTagCatalog
): WorkflowAuthoringStore {
  let records = port.records.filter(isTemplateRecord);
  const list = (): readonly WorkflowAuthoringTemplate[] =>
    records
      .map(templateFrom)
      .sort((left, right) => left.title.localeCompare(right.title));
  const find = (id: string): TemplateRecord => {
    const record = records.find((candidate) => candidate.id === id);
    if (!record) throw new WorkflowAuthoringError('template_not_found');
    return record;
  };

  return {
    list: () => {
      availability(port);
      return Promise.resolve(list());
    },
    get: (id) => {
      availability(port);
      const record = records.find((candidate) => candidate.id === id);
      return Promise.resolve(record ? templateFrom(record) : null);
    },
    create: async (input: CreateWorkflowAuthoringTemplateInput) => {
      availability(port);
      const title = cleanTitle(input.title);
      const suppliedSteps = input.steps?.length
        ? input.steps
        : [{ title: 'First step' }];
      const record: TemplateRecord = {
        id: newId('workflow-template'),
        kind: 'workflow_authoring_template',
        matterId: 'firm_home',
        title,
        authoringStatus: 'draft',
        tagIds: validateTags(input.tagIds ?? [], catalog),
        steps: suppliedSteps.map((step, position) => ({
          id: newId('workflow-step'),
          title: cleanTitle(step.title),
          position,
          tagIds: validateTags(step.tagIds ?? [], catalog),
        })),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await saveAndReload(port, record);
      records = [...records, record];
      return templateFrom(record);
    },
    update: async (input: UpdateWorkflowAuthoringTemplateInput) => {
      availability(port);
      const previous = find(input.id);
      const previousSteps = new Map(
        previous.steps.map((step) => [step.id, step])
      );
      const steps = input.steps.map((step, position) => {
        const prior = previousSteps.get(step.id);
        return {
          ...validStep(step, position),
          tagIds: validateTags(step.tagIds, catalog, prior?.tagIds),
        };
      });
      if (!steps.length) throw new WorkflowAuthoringError('invalid_template');
      const record: TemplateRecord = {
        ...previous,
        title: cleanTitle(input.title),
        tagIds: validateTags(input.tagIds, catalog, previous.tagIds),
        steps,
        updatedAt: new Date().toISOString(),
      };
      await saveAndReload(port, record);
      records = records.map((candidate) =>
        candidate.id === record.id ? record : candidate
      );
      return templateFrom(record);
    },
    publish: async (id) => {
      availability(port);
      const previous = find(id);
      const record: TemplateRecord = {
        ...previous,
        authoringStatus: 'published',
        updatedAt: new Date().toISOString(),
      };
      await saveAndReload(port, record);
      records = records.map((candidate) =>
        candidate.id === record.id ? record : candidate
      );
      return templateFrom(record);
    },
    start: async (templateId, householdId): Promise<WorkflowAuthoringStart> => {
      availability(port);
      const template = find(templateId);
      if (template.authoringStatus !== 'published') {
        throw new WorkflowAuthoringError('template_not_published');
      }
      const cleanedHouseholdId = householdId.trim();
      if (!cleanedHouseholdId)
        throw new WorkflowAuthoringError('invalid_household');
      const start: WorkflowAuthoringStart = {
        id: newId('workflow-start'),
        templateId,
        householdId: cleanedHouseholdId,
      };
      await saveAndReload(port, {
        ...start,
        kind: 'workflow_authoring_start',
        matterId: cleanedHouseholdId,
        startedAt: new Date().toISOString(),
      });
      return start;
    },
  };
}
