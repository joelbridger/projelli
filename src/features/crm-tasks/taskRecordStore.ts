import { useLiveCrmRecords } from '@/platform/crm/useLiveCrmRecords';
import type { LiveCrmRecord } from '@/platform/crm/liveRecords';
import type { EntityRef, RecurrenceRule, Task } from '@/platform/crm/types';
import { validateContactRef, type ContactRef } from '@/features/crm-contacts';
import { softDeleteCrmRecord } from '@/features/crm-trash';
import {
  resolveMeetingVisibility,
  type MeetingVisibilitySubject,
  type MeetingVisibilitySubjectRef,
} from '@/platform/meeting-visibility';
import { useFirmStore } from '@/platform/firm/firmStore';
import { SK_INSTALL_ID } from '@/config/identity';

export type TaskStatus = Task['status'];
export type TaskPriority = Task['priority'];

export type TaskHouseholdRef = Pick<EntityRef, 'kind' | 'id' | 'matterId' | 'label'> & {
  kind: 'household';
};

export type TaskDocumentRef = Pick<EntityRef, 'kind' | 'id' | 'matterId' | 'label'> & {
  kind: 'document';
};

/** Public task relation: existing Documents pointers plus any durable contact kind. */
export type TaskContextRef = TaskDocumentRef | ContactRef;

/** The task fields feature lanes may read. Storage metadata stays private. */
export interface TaskRecord {
  readonly id: string;
  readonly title: string;
  readonly body: string;
  readonly householdRef: TaskHouseholdRef | null;
  readonly assigneeUserId: string | null;
  readonly status: TaskStatus;
  readonly due?: string;
  readonly dueTime?: string;
  readonly recurrence?: RecurrenceRule;
  readonly priority: TaskPriority;
  readonly category?: string;
  readonly tagIds: readonly string[];
  readonly contextRefs: readonly TaskContextRef[];
  /** Exact meeting lineage, retained by duplicates and recurring copies. */
  readonly meetingVisibility?: MeetingVisibilitySubject;
}

export interface CreateTaskRecordInput {
  title: string;
  body?: string;
  householdRef?: TaskHouseholdRef | null;
  assigneeUserId?: string | null;
  status?: TaskStatus;
  due?: string;
  dueTime?: string;
  recurrence?: RecurrenceRule;
  priority?: TaskPriority;
  category?: string;
  tagIds?: readonly string[];
  contextRefs?: readonly TaskContextRef[];
  /** Set only when this task is derived from an already-authoritative parent. */
  meetingVisibilityParent?: MeetingVisibilitySubject;
}

/** `null` clears an optional value; omitted fields retain their current value. */
export interface UpdateTaskRecordPatch {
  title?: string;
  body?: string;
  householdRef?: TaskHouseholdRef | null;
  assigneeUserId?: string | null;
  status?: TaskStatus;
  due?: string | null;
  dueTime?: string | null;
  recurrence?: RecurrenceRule | null;
  priority?: TaskPriority;
  category?: string | null;
  tagIds?: readonly string[];
  contextRefs?: readonly TaskContextRef[];
}

/** Async because every mutation uses the encrypted canonical live-record route. */
export interface TaskRecordStore {
  get(id: string): Promise<TaskRecord | undefined>;
  create(input: CreateTaskRecordInput): Promise<TaskRecord>;
  update(id: string, patch: UpdateTaskRecordPatch): Promise<TaskRecord>;
  /** Moves the canonical task into the shared, restorable CRM trash. */
  remove(id: string): Promise<void>;
}

type LiveTaskPort = Pick<
  ReturnType<typeof useLiveCrmRecords>,
  'records' | 'workspaceRoot' | 'error' | 'save' | 'reload'
>;

const TASK_STATUSES: readonly TaskStatus[] = [
  'open',
  'in_progress',
  'blocked',
  'done',
  'cancelled',
];
const TASK_PRIORITIES: readonly TaskPriority[] = ['high', 'normal', 'low'];
const RECURRENCE_FREQUENCIES: readonly RecurrenceRule['freq'][] = [
  'daily',
  'weekly',
  'monthly',
  'yearly',
];

function actor(firmUserId: string | null | undefined) {
  if (firmUserId)
    return { userId: firmUserId, display: 'You', kind: 'user' as const };
  let installId: string | null = null;
  if (typeof localStorage !== 'undefined') {
    installId = localStorage.getItem(SK_INSTALL_ID);
    if (!installId) {
      installId = crypto.randomUUID();
      localStorage.setItem(SK_INSTALL_ID, installId);
    }
  }
  return {
    userId: `solo:${installId ?? crypto.randomUUID()}`,
    display: 'You',
    kind: 'user' as const,
  };
}

function timestamp(): string {
  return new Date().toISOString();
}

function taskId(): string {
  return `task-${crypto.randomUUID()}`;
}

function derivedTaskVisibility(
  id: string,
  parent: MeetingVisibilitySubject
): MeetingVisibilitySubject {
  if (parent.lineage === 'legacy-unrestricted')
    return { kind: 'task', id, lineage: 'legacy-unrestricted' };
  return {
    kind: 'task',
    id,
    lineage: 'derived',
    parentRef: { kind: parent.kind, id: parent.id },
    ...(parent.ownerRef ? { ownerRef: parent.ownerRef } : {}),
    ...(parent.visibilityPolicyId
      ? { visibilityPolicyId: parent.visibilityPolicyId }
      : {}),
  };
}

function storedTaskVisibility(record: LiveCrmRecord): MeetingVisibilitySubject {
  const stored = record['meetingVisibility'];
  if (stored && typeof stored === 'object' && !Array.isArray(stored)) {
    const subject = stored as Partial<MeetingVisibilitySubject>;
    if (subject.kind === 'task' && subject.id === record.id)
      return stored as MeetingVisibilitySubject;
    return { kind: 'task', id: record.id, lineage: 'derived' } as MeetingVisibilitySubject;
  }
  const origin =
    record['source'] && typeof record['source'] === 'object'
      ? (record['source'] as { origin?: unknown }).origin
      : undefined;
  // Missing lineage on anything marked meeting-origin is malformed and must
  // stay hidden. This deliberately malformed shape is rejected by the shared
  // resolver; ordinary old tasks are explicitly adapted as legacy records.
  return origin === 'meeting'
    ? ({ kind: 'task', id: record.id, lineage: 'derived' } as MeetingVisibilitySubject)
    : { kind: 'task', id: record.id, lineage: 'legacy-unrestricted' };
}

function rootSubject(record: LiveCrmRecord): MeetingVisibilitySubject | null {
  if (
    record.kind !== 'meeting' ||
    typeof record['ownerRef'] !== 'string' ||
    !record['ownerRef'].trim()
  )
    return null;
  return {
    kind: 'meeting-note',
    id: record.id,
    lineage: 'root',
    ownerRef: record['ownerRef'],
    ...(typeof record['visibilityPolicyId'] === 'string'
      ? { visibilityPolicyId: record['visibilityPolicyId'] }
      : {}),
  };
}

function canReadVisibilitySubject(
  subject: MeetingVisibilitySubject,
  records: readonly LiveCrmRecord[],
  viewerId: string | null | undefined
): boolean {
  const preferences = records.filter(
    (candidate) => candidate.kind === 'meeting_foundation_preferences'
  );
  const resolveParent = (ref: MeetingVisibilitySubjectRef) => {
    if (ref.kind === 'meeting-note') {
      const matches = records
        .filter((candidate) => candidate.kind === 'meeting' && candidate.id === ref.id)
        .flatMap((candidate) => {
          const root = rootSubject(candidate);
          return root ? [root] : [];
        });
      return matches.length === 1 ? matches[0] : null;
    }
    const matches = records.flatMap((candidate) => {
      const stored = candidate['meetingVisibility'];
      if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return [];
      const subject = stored as Partial<MeetingVisibilitySubject>;
      const expectedKind =
        candidate.kind === 'meeting_artifact'
          ? 'meeting-artifact'
          : candidate.kind === 'task'
            ? 'task'
            : candidate.kind === 'activityEvent'
              ? 'activity'
              : candidate.kind === 'proposalRecord'
                ? 'proposal'
                : candidate.kind === 'crm_workflow_instance'
                  ? 'workflow'
                  : null;
      return expectedKind === ref.kind &&
        subject.kind === expectedKind &&
        subject.id === candidate.id &&
        subject.id === ref.id
        ? [stored as MeetingVisibilitySubject]
        : [];
    });
    return matches.length === 1 ? matches[0] : null;
  };
  return resolveMeetingVisibility({
    subject,
    viewerId,
    policies:
      preferences.length === 1 && Array.isArray(preferences[0]?.['visibilityPolicies'])
        ? preferences[0]['visibilityPolicies'] as unknown[]
        : [],
    resolveParent,
  }).visible;
}

function canReadTask(
  record: LiveCrmRecord,
  records: readonly LiveCrmRecord[],
  viewerId: string | null | undefined
): boolean {
  return canReadVisibilitySubject(
    storedTaskVisibility(record),
    records,
    viewerId
  );
}

function requireAvailable(port: LiveTaskPort): void {
  if (!port.workspaceRoot) throw new Error('Open a workspace before saving a task.');
  if (port.error) throw new Error('Tasks are unavailable until CRM records reload.');
}

function cleanTitle(value: string): string {
  const title = value.trim();
  if (!title) throw new Error('A task title is required.');
  return title;
}

function cleanOptionalText(value: string): string | undefined {
  const clean = value.trim();
  return clean || undefined;
}

function cleanDueTime(value: string): string {
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) {
    throw new Error('Task due time must use 24-hour HH:mm format.');
  }
  return value;
}

function cleanStatus(value: unknown): TaskStatus {
  if (typeof value !== 'string' || !TASK_STATUSES.includes(value as TaskStatus)) {
    throw new Error('Task status is malformed.');
  }
  return value as TaskStatus;
}

function cleanPriority(value: unknown): TaskPriority {
  if (typeof value !== 'string' || !TASK_PRIORITIES.includes(value as TaskPriority)) {
    throw new Error('Task priority is malformed.');
  }
  return value as TaskPriority;
}

function cleanTagIds(values: readonly string[]): string[] {
  const candidates: readonly unknown[] = values;
  if (candidates.some((value) => typeof value !== 'string')) {
    throw new Error('Task tags must use stable non-empty IDs.');
  }
  const ids = candidates.map((value) => String(value).trim());
  if (ids.some((id, index) => !id || id !== candidates[index])) {
    throw new Error('Task tags must use stable non-empty IDs.');
  }
  if (new Set(ids).size !== ids.length) {
    throw new Error('Task tag IDs must not be duplicated.');
  }
  return ids;
}

function storedTagIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((id): id is string => typeof id === 'string' && Boolean(id.trim())))];
}

function cleanHouseholdRef(value: TaskHouseholdRef | null): TaskHouseholdRef | null {
  if (value === null) return null;
  const candidate: unknown = value;
  if (!candidate || typeof candidate !== 'object') {
    throw new Error('Task household relation is malformed.');
  }
  const ref = candidate as Record<string, unknown>;
  if (ref['kind'] !== 'household' || typeof ref['id'] !== 'string' || !ref['id'].trim()) {
    throw new Error('Task household relation is malformed.');
  }
  return {
    kind: 'household',
    id: ref['id'].trim(),
    ...(typeof ref['matterId'] === 'string' ? { matterId: ref['matterId'] } : {}),
    ...(typeof ref['label'] === 'string' ? { label: ref['label'] } : {}),
  };
}

function taskMatterId(householdRef: TaskHouseholdRef | null): string | null {
  if (!householdRef) return null;
  const matterId = householdRef.matterId?.trim() || householdRef.id.trim();
  return matterId || null;
}

function cleanDocumentRefs(
  values: readonly TaskDocumentRef[],
  householdRef: TaskHouseholdRef | null
): TaskDocumentRef[] {
  const targetMatterId = taskMatterId(householdRef);
  const paths = new Set<string>();
  return values.map((value) => {
    const candidate: unknown = value;
    if (!candidate || typeof candidate !== 'object') {
      throw new Error('Task document reference is malformed.');
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
      throw new Error('Task document reference is malformed.');
    }
    if (paths.has(path)) {
      throw new Error('Task document references must not be duplicated.');
    }
    if (
      !targetMatterId ||
      typeof ref['matterId'] !== 'string' ||
      ref['matterId'].trim() !== targetMatterId
    ) {
      throw new Error('Task documents must belong to the same client as the task.');
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

function storedDocumentRefs(value: unknown): TaskDocumentRef[] {
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
    return [{
      kind: 'document' as const,
      id: path,
      ...(typeof ref.matterId === 'string' ? { matterId: ref.matterId } : {}),
      ...(typeof ref.label === 'string' ? { label: ref.label } : {}),
    }];
  });
}

function cleanContextRefs(
  values: readonly TaskContextRef[],
  householdRef: TaskHouseholdRef | null,
): TaskContextRef[] {
  const targetMatterId = taskMatterId(householdRef);
  const documents = cleanDocumentRefs(
    values.filter((value): value is TaskDocumentRef => value.kind === 'document'),
    householdRef,
  );
  const documentById = new Map(documents.map((ref) => [ref.id, ref]));
  const seen = new Set<string>();
  return values.map((value) => {
    if (value.kind === 'document') {
      const document = documentById.get(value.id.replace(/\\/g, '/'));
      if (!document) throw new Error('Task document reference is malformed.');
      const key = `${document.kind}:${document.id}`;
      if (seen.has(key)) throw new Error('Task context references must not be duplicated.');
      seen.add(key);
      return document;
    }
    const contact = validateContactRef(value);
    if (targetMatterId && contact.matterId !== targetMatterId) {
      throw new Error('Task contacts must belong to the same client as the task.');
    }
    const key = `${contact.kind}:${contact.id}`;
    if (seen.has(key)) throw new Error('Task context references must not be duplicated.');
    seen.add(key);
    return contact;
  });
}

function storedContextRefs(value: unknown): TaskContextRef[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.flatMap((candidate): TaskContextRef[] => {
    const document = storedDocumentRefs([candidate])[0];
    if (document) {
      const key = `${document.kind}:${document.id}`;
      if (seen.has(key)) return [];
      seen.add(key);
      return [document];
    }
    try {
      const contact = validateContactRef(candidate as ContactRef);
      const key = `${contact.kind}:${contact.id}`;
      if (seen.has(key)) return [];
      seen.add(key);
      return [contact];
    } catch {
      return [];
    }
  });
}

function storedHouseholdRef(value: unknown): TaskHouseholdRef | null {
  if (!value || typeof value !== 'object') return null;
  const ref = value as Partial<EntityRef>;
  if (ref.kind !== 'household' || typeof ref.id !== 'string' || !ref.id.trim()) return null;
  return {
    kind: 'household',
    id: ref.id,
    ...(typeof ref.matterId === 'string' ? { matterId: ref.matterId } : {}),
    ...(typeof ref.label === 'string' ? { label: ref.label } : {}),
  };
}

function storedRecurrence(value: unknown): RecurrenceRule | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const record = value as Partial<RecurrenceRule>;
  if (!RECURRENCE_FREQUENCIES.includes(record.freq as RecurrenceRule['freq'])) return undefined;
  if (!Number.isInteger(record.interval) || Number(record.interval) < 1) return undefined;
  return {
    freq: record.freq as RecurrenceRule['freq'],
    interval: Number(record.interval),
    regenerateOnComplete: record.regenerateOnComplete !== false,
    ...(Array.isArray(record.byWeekday) ? { byWeekday: [...record.byWeekday] } : {}),
    ...(Array.isArray(record.byMonthDay) ? { byMonthDay: [...record.byMonthDay] } : {}),
    ...(typeof record.count === 'number' ? { count: record.count } : {}),
    ...(typeof record.until === 'string' ? { until: record.until } : {}),
  };
}

function cleanRecurrence(value: RecurrenceRule): RecurrenceRule {
  const stored = storedRecurrence(value);
  if (!stored) throw new Error('Task recurrence is malformed.');
  return stored;
}

function toTaskRecord(record: LiveCrmRecord): TaskRecord {
  const status = TASK_STATUSES.includes(record['status'] as TaskStatus)
    ? record['status'] as TaskStatus
    : 'open';
  const priority = TASK_PRIORITIES.includes(record['priority'] as TaskPriority)
    ? record['priority'] as TaskPriority
    : 'normal';
  const dueTime = typeof record['dueTime'] === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(record['dueTime'])
    ? record['dueTime']
    : undefined;
  const recurrence = storedRecurrence(record['recurrence']);
  const category = typeof record['category'] === 'string' ? cleanOptionalText(record['category']) : undefined;
  return {
    id: record.id,
    title: typeof record['title'] === 'string' ? record['title'] : 'Untitled task',
    body: typeof record['body'] === 'string' ? record['body'] : '',
    householdRef: storedHouseholdRef(record['householdRef']),
    assigneeUserId: typeof record['assigneeUserId'] === 'string' ? record['assigneeUserId'] : null,
    status,
    ...(typeof record['due'] === 'string' ? { due: record['due'] } : {}),
    ...(dueTime ? { dueTime } : {}),
    ...(recurrence ? { recurrence } : {}),
    priority,
    ...(category ? { category } : {}),
    tagIds: storedTagIds(record['tagIds']),
    contextRefs: storedContextRefs(record['contextRefs']),
    meetingVisibility: storedTaskVisibility(record),
  };
}

function canonicalTask(
  input: CreateTaskRecordInput,
  currentActor: ReturnType<typeof actor>
): LiveCrmRecord & Task {
  const now = timestamp();
  const dueTime = input.dueTime === undefined ? undefined : cleanDueTime(input.dueTime);
  const category = input.category === undefined ? undefined : cleanOptionalText(input.category);
  const householdRef = cleanHouseholdRef(input.householdRef ?? null);
  const id = taskId();
  const canonical: Task = {
    id,
    kind: 'task',
    matterId: 'firm_home',
    createdAt: now,
    createdBy: currentActor,
    updatedAt: now,
    updatedBy: currentActor,
    source: { origin: 'user', sources: [] },
    deleted: false,
    externalRefs: [],
    schemaVersion: 1,
    householdRef,
    title: cleanTitle(input.title),
    body: input.body ?? '',
    assigneeUserId: input.assigneeUserId ?? null,
    status: cleanStatus(input.status ?? 'open'),
    ...(input.due ? { due: input.due } : {}),
    ...(dueTime ? { dueTime } : {}),
    ...(input.recurrence ? { recurrence: cleanRecurrence(input.recurrence) } : {}),
    priority: cleanPriority(input.priority ?? 'normal'),
    ...(category ? { category } : {}),
    tagIds: cleanTagIds(input.tagIds ?? []),
    contextRefs: cleanContextRefs(input.contextRefs ?? [], householdRef),
    customFields: {},
  };
  return {
    ...canonical,
    meetingVisibility: input.meetingVisibilityParent
      ? derivedTaskVisibility(id, input.meetingVisibilityParent)
      : { kind: 'task', id, lineage: 'legacy-unrestricted' },
  } as LiveCrmRecord & Task;
}

function mergePatch(
  record: LiveCrmRecord,
  patch: UpdateTaskRecordPatch,
  currentActor: ReturnType<typeof actor>
): LiveCrmRecord {
  const next: LiveCrmRecord = {
    ...record,
    updatedAt: timestamp(),
    updatedBy: currentActor,
  };
  if ('title' in patch) next['title'] = cleanTitle(patch.title);
  if ('body' in patch) next['body'] = patch.body;
  if ('householdRef' in patch) next['householdRef'] = cleanHouseholdRef(patch.householdRef ?? null);
  if ('assigneeUserId' in patch) next['assigneeUserId'] = patch.assigneeUserId ?? null;
  if ('status' in patch) next['status'] = cleanStatus(patch.status);
  if ('priority' in patch) next['priority'] = cleanPriority(patch.priority);
  if ('due' in patch) {
    if (patch.due === null) delete next['due'];
    else next['due'] = patch.due;
  }
  if ('dueTime' in patch) {
    if (patch.dueTime === null) delete next['dueTime'];
    else next['dueTime'] = cleanDueTime(patch.dueTime);
  }
  if ('recurrence' in patch) {
    if (patch.recurrence === null) delete next['recurrence'];
    else next['recurrence'] = cleanRecurrence(patch.recurrence);
  }
  if ('category' in patch) {
    const category = patch.category === null ? undefined : cleanOptionalText(patch.category);
    if (category) next['category'] = category;
    else delete next['category'];
  }
  if ('tagIds' in patch) next['tagIds'] = cleanTagIds(patch.tagIds);
  if ('contextRefs' in patch || 'householdRef' in patch) {
    const requestedRefs = 'contextRefs' in patch
      ? patch.contextRefs
      : storedContextRefs(record['contextRefs']);
    const nextHouseholdRef = storedHouseholdRef(next['householdRef']);
    next['contextRefs'] = cleanContextRefs(requestedRefs, nextHouseholdRef);
  }
  return next;
}

function createTaskRecordStore(
  port: LiveTaskPort,
  viewerId: string | null | undefined
): TaskRecordStore {
  const currentActor = actor(viewerId);
  const tasks = port.records.filter(
    (record) =>
      record.kind === 'task' && canReadTask(record, port.records, viewerId)
  );
  const saveAndReload = async (record: LiveCrmRecord): Promise<TaskRecord> => {
    try {
      const saved = await port.save(record);
      await port.reload();
      return toTaskRecord(saved);
    } catch (error: unknown) {
      if (error instanceof Error) throw error;
      throw new Error('The task could not be saved.');
    }
  };
  return {
    get: (id) => Promise.resolve().then(() => {
      requireAvailable(port);
      const record = tasks.find((candidate) => candidate.id === id);
      return record ? toTaskRecord(record) : undefined;
    }),
    create: async (input) => {
      requireAvailable(port);
      if (
        input.meetingVisibilityParent &&
        !canReadVisibilitySubject(
          input.meetingVisibilityParent,
          port.records,
          viewerId
        )
      )
        throw new Error('This private meeting task is not available.');
      return saveAndReload(canonicalTask(input, currentActor));
    },
    update: async (id, patch) => {
      requireAvailable(port);
      const record = tasks.find((candidate) => candidate.id === id);
      if (!record) throw new Error('That task no longer exists.');
      return saveAndReload(mergePatch(record, patch, currentActor));
    },
    remove: async (id) => {
      requireAvailable(port);
      const record = tasks.find((candidate) => candidate.id === id);
      if (!record) throw new Error('That task no longer exists.');
      const matterId = record.matterId?.trim();
      if (!matterId) throw new Error('That task has no valid storage scope.');
      await softDeleteCrmRecord({
        workspaceRoot: port.workspaceRoot,
        recordId: record.id,
        matterId,
        actorId: currentActor.userId,
      });
      await port.reload();
    },
  };
}

/** Reactive adapter over the current canonical live-record snapshot. */
export function useTaskRecordStore(): TaskRecordStore {
  const viewerId = useFirmStore((state) => state.session?.userId ?? null);
  return createTaskRecordStore(useLiveCrmRecords(), viewerId);
}
