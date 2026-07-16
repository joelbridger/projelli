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
  due?: string;
  dueTime?: string;
  relationPrompt?: string;
  tagIds?: readonly string[];
};

type ReactiveTaskTemplateStore = TaskTemplateStore & {
  readonly recordSnapshot: readonly LiveCrmRecord[];
};

interface NormalizedTemplateInput {
  name: string;
  title: string;
  body: string;
  priority: TaskPriority;
  category?: string;
  due?: string;
  dueTime?: string;
  relationPrompt?: string;
  tagIds: string[];
}

const priorities: readonly TaskPriority[] = ['high', 'normal', 'low'];
const dueTimePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

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
    due: cleanText(record.due) ?? null,
    dueTime: typeof record.dueTime === 'string' && dueTimePattern.test(record.dueTime)
      ? record.dueTime
      : null,
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
  const due = cleanText(input.due);
  const dueTime = cleanText(input.dueTime);
  const relationPrompt = cleanText(input.relationPrompt);
  if (!priorities.includes(priority)) {
    throw error('invalid_template', 'Template priority is invalid.');
  }
  if (dueTime && !dueTimePattern.test(dueTime)) {
    throw error('invalid_template', 'Template due time must use 24-hour HH:mm format.');
  }
  return {
    name: cleanRequired(input.name, 'name'),
    title: cleanRequired(input.title, 'title'),
    body: cleanText(input.body) ?? '',
    priority,
    ...(category ? { category } : {}),
    ...(due ? { due } : {}),
    ...(dueTime ? { dueTime } : {}),
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

function updateTemplateRecord(
  current: CanonicalTaskTemplate,
  input: NormalizedTemplateInput
): CanonicalTaskTemplate {
  const updated: CanonicalTaskTemplate = { ...current, ...input, updatedAt: timestamp() };
  if (!input.category) delete updated.category;
  if (!input.due) delete updated.due;
  if (!input.dueTime) delete updated.dueTime;
  if (!input.relationPrompt) delete updated.relationPrompt;
  return updated;
}

/** Feature-private persistence adapter over canonical encrypted live records. */
export function createTaskTemplateStore(port: LiveTaskTemplatePort): TaskTemplateStore {
  const templates = () => port.records.filter(isTemplate);
  const find = (id: string): CanonicalTaskTemplate => {
    const template = templates().find((candidate) => candidate.id === id);
    if (!template) throw error('template_not_found', 'That task template no longer exists.');
    return template;
  };
  const saveAndReload = async (record: CanonicalTaskTemplate): Promise<CanonicalTaskTemplate> => {
    try {
      const saved = await port.save(record) as CanonicalTaskTemplate;
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
      return toTemplate(await saveAndReload(updateTemplateRecord(current, next)));
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
          ...(template.due ? { due: template.due } : {}),
          ...(template.dueTime ? { dueTime: template.dueTime } : {}),
          tagIds: template.tagIds,
        },
      };
    }),
  };
}

export function useTaskTemplateStore(): ReactiveTaskTemplateStore {
  const live = useLiveCrmRecords();
  return Object.assign(createTaskTemplateStore(live), {
    /** Lets the library refresh when the canonical record snapshot arrives. */
    recordSnapshot: live.records,
  });
}
