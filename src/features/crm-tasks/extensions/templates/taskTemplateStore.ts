import { useLiveCrmRecords } from '@/platform/crm/useLiveCrmRecords';
import type { LiveCrmRecord } from '@/platform/crm/liveRecords';
import type { TaskPriority } from '@/features/crm-tasks';
import {
  type AppliedTaskTemplate,
  type SaveTaskTemplateInput,
  type TaskTemplate,
  type TaskTemplateStore,
  TaskTemplateError,
} from './contract';

type LiveTaskTemplatePort = Pick<
  ReturnType<typeof useLiveCrmRecords>,
  'records' | 'workspaceRoot' | 'error' | 'save' | 'reload'
>;

type CanonicalTaskTemplate = LiveCrmRecord & {
  kind: 'task_template';
  name: string;
  title: string;
  body?: string;
  priority?: TaskPriority;
  category?: string;
  relationPrompt?: string;
  tagIds?: readonly string[];
};

interface NormalizedTemplateInput {
  name: string;
  title: string;
  body: string;
  priority: TaskPriority;
  category?: string;
  relationPrompt?: string;
  tagIds: string[];
}

const priorities: readonly TaskPriority[] = ['high', 'normal', 'low'];

function error(code: ConstructorParameters<typeof TaskTemplateError>[0], message: string) {
  return new TaskTemplateError(code, message);
}

function actor() {
  return { userId: 'local-user', display: 'You', kind: 'user' as const };
}

function timestamp() {
  return new Date().toISOString();
}

function cleanText(value: string | null | undefined): string | undefined {
  const clean = value?.trim();
  return clean || undefined;
}

function cleanRequired(value: string, label: string): string {
  const clean = cleanText(value);
  if (!clean) throw error('invalid_template', `A template ${label} is required.`);
  return clean;
}

function cleanTags(values: readonly string[]): string[] {
  if (values.some((id) => typeof id !== 'string' || !id.trim() || id !== id.trim())) {
    throw error('invalid_template', 'Template tags must use stable non-empty IDs.');
  }
  if (new Set(values).size !== values.length) {
    throw error('invalid_template', 'Template tag IDs must not be duplicated.');
  }
  return [...values];
}

function storedTags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((id): id is string => typeof id === 'string' && Boolean(id.trim())))];
}

function isTemplate(record: LiveCrmRecord): record is CanonicalTaskTemplate {
  return record.kind === 'task_template' &&
    typeof record['name'] === 'string' &&
    typeof record['title'] === 'string';
}

function toTemplate(record: CanonicalTaskTemplate): TaskTemplate {
  return {
    id: record.id,
    name: record.name,
    title: record.title,
    body: typeof record.body === 'string' ? record.body : '',
    priority: priorities.includes(record.priority as TaskPriority)
      ? record.priority as TaskPriority
      : 'normal',
    category: cleanText(record.category) ?? null,
    relationPrompt: cleanText(record.relationPrompt) ?? null,
    tagIds: storedTags(record.tagIds),
    retired: Boolean(record['deleted']),
  };
}

function requireAvailable(port: LiveTaskTemplatePort): void {
  if (!port.workspaceRoot) {
    throw error('workspace_unavailable', 'Open a workspace before saving a task template.');
  }
  if (port.error) {
    throw error('persistence_failed', 'Task templates are unavailable until CRM records reload.');
  }
}

function cleanInput(input: SaveTaskTemplateInput): NormalizedTemplateInput {
  const priority = input.priority ?? 'normal';
  const category = cleanText(input.category);
  const relationPrompt = cleanText(input.relationPrompt);
  if (!priorities.includes(priority)) {
    throw error('invalid_template', 'Template priority is invalid.');
  }
  return {
    name: cleanRequired(input.name, 'name'),
    title: cleanRequired(input.title, 'title'),
    body: cleanText(input.body) ?? '',
    priority,
    ...(category ? { category } : {}),
    ...(relationPrompt ? { relationPrompt } : {}),
    tagIds: cleanTags(input.tagIds ?? []),
  };
}

function templateRecord(input: NormalizedTemplateInput): CanonicalTaskTemplate {
  const now = timestamp();
  return {
    id: `task-template:${crypto.randomUUID()}`,
    kind: 'task_template',
    matterId: 'firm_home',
    createdAt: now,
    createdBy: actor(),
    updatedAt: now,
    updatedBy: actor(),
    source: { origin: 'user', sources: [] },
    deleted: false,
    externalRefs: [],
    schemaVersion: 1,
    ...input,
  };
}

/** Feature-private persistence adapter over canonical encrypted live records. */
export function createTaskTemplateStore(port: LiveTaskTemplatePort): TaskTemplateStore {
  let records = [...port.records];
  const templates = () => records.filter(isTemplate);
  const find = (id: string): CanonicalTaskTemplate => {
    const template = templates().find((candidate) => candidate.id === id);
    if (!template) throw error('template_not_found', 'That task template no longer exists.');
    return template;
  };
  const saveAndReload = async (record: CanonicalTaskTemplate): Promise<CanonicalTaskTemplate> => {
    try {
      const saved = await port.save(record) as CanonicalTaskTemplate;
      records = records.some((candidate) => candidate.id === saved.id)
        ? records.map((candidate) => candidate.id === saved.id ? saved : candidate)
        : [...records, saved];
      await port.reload();
      return saved;
    } catch (cause: unknown) {
      if (cause instanceof TaskTemplateError) throw cause;
      throw error('persistence_failed', 'The task template could not be saved.');
    }
  };

  return {
    list: () => Promise.resolve().then(() => {
      requireAvailable(port);
      return templates().map(toTemplate).sort((left, right) => left.name.localeCompare(right.name));
    }),
    create: async (input) => {
      requireAvailable(port);
      return toTemplate(await saveAndReload(templateRecord(cleanInput(input))));
    },
    update: async (id, input) => {
      requireAvailable(port);
      const current = find(id);
      if (current['deleted']) throw error('template_retired', 'Retired task templates cannot be edited.');
      const next = cleanInput(input);
      return toTemplate(await saveAndReload({ ...current, ...next, updatedAt: timestamp() }));
    },
    retire: async (id) => {
      requireAvailable(port);
      const current = find(id);
      if (current['deleted']) return toTemplate(current);
      return toTemplate(await saveAndReload({ ...current, deleted: true, updatedAt: timestamp() }));
    },
    apply: (id): Promise<AppliedTaskTemplate> => Promise.resolve().then(() => {
      requireAvailable(port);
      const template = toTemplate(find(id));
      if (template.retired) throw error('template_retired', 'Retired task templates cannot be applied.');
      return {
        template,
        taskInput: {
          title: template.title,
          body: template.body,
          priority: template.priority,
          ...(template.category ? { category: template.category } : {}),
          tagIds: template.tagIds,
        },
      };
    }),
  };
}

export function useTaskTemplateStore(): TaskTemplateStore {
  return createTaskTemplateStore(useLiveCrmRecords());
}
