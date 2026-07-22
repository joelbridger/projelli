import type { LiveCrmRecord } from '@/platform/crm/liveRecords';
import type { EntityRef } from '@/platform/crm/types';
import type { CrmTask } from '../types';
import type { MeetingVisibilitySubject } from '@/platform/meeting-visibility';
import {
  derivedMeetingVisibility,
  explicitLegacyMeetingVisibility,
  meetingVisibilityParentForRecord,
} from './meetingDerivedVisibility';

const VALID_DUE_TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

function entityRefs(value: unknown): EntityRef[] {
  return Array.isArray(value)
    ? value.filter((candidate): candidate is EntityRef =>
        Boolean(candidate) &&
        typeof candidate === 'object' &&
        typeof (candidate as Partial<EntityRef>).kind === 'string' &&
        typeof (candidate as Partial<EntityRef>).id === 'string'
      )
    : [];
}

function householdContextIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate) => {
    if (typeof candidate === 'string' && candidate.trim()) return [candidate];
    if (!candidate || typeof candidate !== 'object') return [];
    const ref = candidate as Partial<EntityRef>;
    return ref.kind === 'household' && typeof ref.id === 'string' && ref.id.trim()
      ? [ref.id]
      : [];
  });
}

function documentRefs(value: unknown): Array<EntityRef & { kind: 'document' }> {
  const seen = new Set<string>();
  return entityRefs(value).flatMap((ref) => {
    if (ref.kind !== 'document' || !ref.id.trim() || seen.has(ref.id)) return [];
    seen.add(ref.id);
    return [{ ...ref, kind: 'document' as const }];
  });
}

function tagIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((id): id is string => typeof id === 'string' && Boolean(id.trim())))];
}

function originatingContactRefs(task: CrmTask, matterId: string | null): EntityRef[] {
  if (!matterId) return [];
  const seen = new Set<string>();
  return (task.originatingContextRefs ?? []).flatMap((ref) => {
    if (ref.kind === 'household') return [];
    const id = ref.id.trim();
    if (!id || ref.matterId !== matterId) return [];
    const key = `${ref.kind}:${id}`;
    if (seen.has(key)) return [];
    seen.add(key);
    return [{
      kind: ref.kind,
      id,
      matterId,
      ...(ref.label?.trim() ? { label: ref.label.trim() } : {}),
    }];
  });
}

function householdIdFor(record: LiveCrmRecord): string | undefined {
  const householdRef = record['householdRef'];
  if (householdRef && typeof householdRef === 'object') {
    const ref = householdRef as Partial<EntityRef>;
    if (ref.kind === 'household' && typeof ref.id === 'string' && ref.id.trim()) return ref.id;
  }
  return householdContextIds(record['contextRefs'])[0];
}

export function projectCrmTask(
  record: LiveCrmRecord,
  labels: { householdLabel?: string; assigneeLabel?: string } = {}
): CrmTask {
  const householdId = householdIdFor(record);
  const recurrence = record['recurrence'];
  const recurrenceFrequency = recurrence && typeof recurrence === 'object'
    ? (recurrence as { freq?: unknown }).freq
    : undefined;
  const validRecurrence = recurrence && typeof recurrence === 'object' &&
    typeof recurrenceFrequency === 'string' && ['daily', 'weekly', 'monthly', 'yearly'].includes(recurrenceFrequency)
    ? {
        freq: recurrenceFrequency as NonNullable<CrmTask['recurrence']>['freq'],
        interval: Math.max(1, Number((recurrence as { interval?: unknown }).interval) || 1),
        regenerateOnComplete: (recurrence as { regenerateOnComplete?: unknown }).regenerateOnComplete !== false,
      }
    : undefined;
  const due = typeof record['due'] === 'string'
    ? record['due']
    : typeof record['dueAt'] === 'string' ? record['dueAt'] : undefined;
  const category = typeof record['category'] === 'string' && record['category'].trim()
    ? record['category']
    : undefined;
  const dueTime = typeof record['dueTime'] === 'string' && VALID_DUE_TIME.test(record['dueTime'])
    ? record['dueTime']
    : undefined;
  const projectedDocuments = documentRefs(record['contextRefs']);
  return {
    id: record.id,
    title: typeof record['title'] === 'string' ? record['title'] : 'Untitled task',
    ...(typeof record['body'] === 'string' ? { body: record['body'] } : {}),
    assigneeUserId: typeof record['assigneeUserId'] === 'string' ? record['assigneeUserId'] : null,
    ...(labels.assigneeLabel ? { assigneeLabel: labels.assigneeLabel } : {}),
    status: record['status'] === 'in_progress' || record['status'] === 'blocked' || record['status'] === 'done' || record['status'] === 'cancelled'
      ? record['status']
      : 'open',
    priority: record['priority'] === 'high' || record['priority'] === 'low' ? record['priority'] : 'normal',
    ...(householdId ? { householdId } : {}),
    ...(labels.householdLabel ? { householdLabel: labels.householdLabel } : {}),
    ...(due ? { dueAt: due, dueLabel: due } : {}),
    ...(dueTime ? { dueTime } : {}),
    ...(category ? { category } : {}),
    tagIds: tagIds(record['tagIds']),
    ...(validRecurrence ? { recurrence: validRecurrence, recurrenceLabel: 'Recurring' } : {}),
    contextRefs: householdContextIds(record['contextRefs']),
    ...(projectedDocuments.length ? { documentRefs: projectedDocuments } : {}),
  };
}

function actor() {
  return { userId: 'local-user', display: 'You', kind: 'user' as const };
}

function validateDueTime(value: string): string {
  if (!VALID_DUE_TIME.test(value)) throw new Error('Task due time must use 24-hour HH:mm format.');
  return value;
}

/** Merge-save used by the legacy Tasks adapter; it never replaces a canonical record with a UI projection. */
export function mergeCrmTaskRecord(
  task: CrmTask,
  current?: LiveCrmRecord,
  mappedHouseholdMatterId?: string,
  visibilityParent?: LiveCrmRecord | MeetingVisibilitySubject
): LiveCrmRecord {
  const now = new Date().toISOString();
  const householdId = task.householdId ?? task.contextRefs?.[0];
  const currentRefs = entityRefs(current?.['contextRefs']);
  const storedHouseholdRef = current?.['householdRef'];
  const storedHousehold = storedHouseholdRef && typeof storedHouseholdRef === 'object'
    ? storedHouseholdRef as Partial<EntityRef>
    : undefined;
  const householdMatterId = mappedHouseholdMatterId?.trim() || (
    storedHousehold?.kind === 'household' &&
    storedHousehold.id === householdId && typeof storedHousehold.matterId === 'string'
      ? storedHousehold.matterId
      : householdId
  );
  const householdRef = householdId
    ? { kind: 'household' as const, id: householdId, matterId: householdMatterId }
    : null;
  const existingRelations = currentRefs.filter(
    (ref) => ref.kind !== 'household' && ref.kind !== 'document'
  );
  const retainedRelations = [...existingRelations];
  const relationKeys = new Set(existingRelations.map((ref) => `${ref.kind}:${ref.id}`));
  for (const ref of originatingContactRefs(task, householdMatterId ?? null)) {
    const key = `${ref.kind}:${ref.id}`;
    if (!relationKeys.has(key)) {
      relationKeys.add(key);
      retainedRelations.push(ref);
    }
  }
  const retainedDocuments = task.documentRefs === undefined
    ? documentRefs(currentRefs)
    : documentRefs(task.documentRefs);
  const retainedContext = [...retainedRelations, ...retainedDocuments];
  const contextRefs = householdRef ? [householdRef, ...retainedContext] : retainedContext;
  const next: LiveCrmRecord = {
    ...(current ?? {}),
    id: task.id,
    kind: 'task',
    matterId: current?.matterId ?? 'firm_home',
    createdAt: current?.createdAt ?? now,
    createdBy: current?.['createdBy'] ?? actor(),
    updatedAt: now,
    updatedBy: actor(),
    source: current?.['source'] ?? { origin: 'user', sources: [] },
    deleted: current?.['deleted'] ?? false,
    externalRefs: current?.['externalRefs'] ?? [],
    schemaVersion: typeof current?.['schemaVersion'] === 'number' ? current['schemaVersion'] : 1,
    title: task.title.trim(),
    body: task.body ?? '',
    assigneeUserId: task.assigneeUserId,
    status: task.status,
    priority: task.priority,
    tagIds: [...task.tagIds],
    householdRef,
    contextRefs,
    customFields: current?.['customFields'] ?? {},
  };
  if (!current) {
    const parent = visibilityParent
      ? 'id' in visibilityParent && 'kind' in visibilityParent &&
          !('lineage' in visibilityParent)
        ? meetingVisibilityParentForRecord(visibilityParent)
        : (visibilityParent as MeetingVisibilitySubject)
      : null;
    next['meetingVisibility'] = parent
      ? derivedMeetingVisibility('task', task.id, parent)
      : explicitLegacyMeetingVisibility('task', task.id);
  }
  if (task.dueAt) next['due'] = task.dueAt;
  else delete next['due'];
  if (task.recurrence) next['recurrence'] = task.recurrence;
  else delete next['recurrence'];
  if (task.category?.trim()) next['category'] = task.category.trim();
  else if (!current || 'category' in task) delete next['category'];
  if (task.dueTime) next['dueTime'] = validateDueTime(task.dueTime);
  else if (!current || 'dueTime' in task) delete next['dueTime'];
  return next;
}
