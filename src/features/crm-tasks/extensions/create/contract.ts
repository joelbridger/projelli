import type {
  TaskHouseholdRef,
  TaskPriority,
  TaskRecord,
  TaskRecordStore,
} from '@/features/crm-tasks';
import type { FirmTagStore } from '@/features/crm-tags';

/**
 * The small request a record-context caller may use to create one task.
 *
 * Callers provide stable tag IDs only. Tag names and lifecycle rules remain
 * in the firm-tag catalog, and task storage remains in the task doorway.
 */
export interface TaskCreateRequest {
  title: string;
  description?: string;
  due?: string;
  dueTime?: string;
  priority?: TaskPriority;
  category?: string;
  relatedRecord?: TaskHouseholdRef | null;
  tagIds?: readonly string[];
}

/** The saved-task identity later task packages may retain. */
export interface TaskCreateResult {
  readonly id: TaskRecord['id'];
}

function validatedRelatedRecord(
  relatedRecord: TaskCreateRequest['relatedRecord']
): TaskHouseholdRef | null | undefined {
  if (relatedRecord === undefined || relatedRecord === null) return relatedRecord;
  const candidate: unknown = relatedRecord;
  if (!candidate || typeof candidate !== 'object') {
    throw new Error('Task related record is malformed.');
  }
  const record = candidate as Record<string, unknown>;
  const id = record['id'];
  if (record['kind'] !== 'household' || typeof id !== 'string' || !id.trim()) {
    throw new Error('Task related record is malformed.');
  }
  return {
    kind: 'household',
    id: id.trim(),
    ...(typeof record['matterId'] === 'string' && record['matterId'].trim()
      ? { matterId: record['matterId'] }
      : {}),
    ...(typeof record['label'] === 'string' && record['label'].trim()
      ? { label: record['label'] }
      : {}),
  };
}

async function validatedTagIds(
  store: FirmTagStore,
  requestedIds: readonly string[]
): Promise<readonly string[]> {
  const catalog = await store.list();
  const known = new Map(catalog.tags.map((tag) => [tag.id, tag]));
  const candidates: readonly unknown[] = requestedIds;
  if (candidates.some((id) => typeof id !== 'string')) {
    throw new Error('Task tags must use unique stable IDs.');
  }
  const ids = candidates.map((id) => String(id).trim());
  if (
    ids.some((id, index) => !id || id !== requestedIds[index]) ||
    new Set(ids).size !== ids.length
  ) {
    throw new Error('Task tags must use unique stable IDs.');
  }
  if (ids.some((id) => known.get(id)?.status !== 'active')) {
    throw new Error('Task tags must refer to active firm tags.');
  }
  return ids;
}

/**
 * Validates reusable references, then writes only through the canonical task
 * store. It intentionally returns only the saved identity, not a second task
 * projection or persistence adapter.
 */
export async function createTask(
  taskStore: TaskRecordStore,
  tagStore: FirmTagStore,
  request: TaskCreateRequest
): Promise<TaskCreateResult> {
  const tagIds = await validatedTagIds(tagStore, request.tagIds ?? []);
  const relatedRecord =
    request.relatedRecord === undefined
      ? undefined
      : validatedRelatedRecord(request.relatedRecord);
  const created = await taskStore.create({
    title: request.title,
    ...(request.description ? { body: request.description } : {}),
    ...(request.due ? { due: request.due } : {}),
    ...(request.dueTime ? { dueTime: request.dueTime } : {}),
    ...(request.priority ? { priority: request.priority } : {}),
    ...(request.category ? { category: request.category } : {}),
    ...(relatedRecord !== undefined
      ? { householdRef: relatedRecord }
      : {}),
    tagIds,
  });
  return { id: created.id };
}
