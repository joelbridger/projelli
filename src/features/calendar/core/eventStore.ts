import { useLiveCrmRecords } from '@/platform/crm/useLiveCrmRecords';
import type { LiveCrmRecord } from '@/platform/crm/liveRecords';
import { expandCalendarEvents } from './recurrence';
import type {
  CalendarContextReference,
  CalendarEventDraft,
  CalendarEventPatch,
  CalendarEventRecord,
  CalendarEventStatus,
  CalendarEventStore,
  CalendarRange,
} from './types';
import { validateCalendarEventDraft, validateContextReference, validateRecurrenceRule } from './validation';

type CalendarLivePort = Pick<
  ReturnType<typeof useLiveCrmRecords>,
  'records' | 'workspaceRoot' | 'error' | 'save' | 'reload'
>;

function actor() {
  return { userId: 'local-user', display: 'You', kind: 'user' as const };
}

function now(): string {
  return new Date().toISOString();
}

function requireAvailable(port: CalendarLivePort): void {
  if (!port.workspaceRoot) throw new Error('Open a workspace before using the calendar.');
  if (port.error) throw new Error('Calendar records are unavailable until CRM records reload.');
}

function storedContext(value: unknown): CalendarContextReference | undefined {
  if (!value || typeof value !== 'object') return undefined;
  try {
    return validateContextReference(value as CalendarContextReference);
  } catch {
    return undefined;
  }
}

function storedString(record: LiveCrmRecord, key: string): string {
  const value = record[key];
  return typeof value === 'string' ? value : '';
}

export function projectCalendarEvent(record: LiveCrmRecord): CalendarEventRecord {
  if (record.kind !== 'calendar_event') throw new Error('That record is not a calendar event.');
  const status: CalendarEventStatus = record['status'] === 'cancelled' ? 'cancelled' : 'scheduled';
  const recurrence = record['recurrence'] === undefined
    ? undefined
    : validateRecurrenceRule(record['recurrence'] as never, storedString(record, 'startUtc'));
  const contextRef = storedContext(record['contextRef']);
  const draft = validateCalendarEventDraft({
    title: storedString(record, 'title'),
    ...(typeof record['notes'] === 'string' ? { notes: record['notes'] } : {}),
    startUtc: storedString(record, 'startUtc'),
    endUtc: storedString(record, 'endUtc'),
    displayTimezone: storedString(record, 'displayTimezone'),
    allDay: record['allDay'] === true,
    calendarId: storedString(record, 'calendarId'),
    ...(contextRef ? { contextRef } : {}),
    ...(recurrence ? { recurrence } : {}),
  });
  return {
    id: record.id,
    kind: 'calendar_event',
    title: draft.title,
    ...(draft.notes ? { notes: draft.notes } : {}),
    startUtc: draft.startUtc,
    endUtc: draft.endUtc,
    displayTimezone: draft.displayTimezone,
    allDay: draft.allDay,
    calendarId: draft.calendarId,
    status,
    ...(draft.contextRef ? { contextRef: draft.contextRef } : {}),
    ...(typeof record['seriesId'] === 'string' && recurrence ? { seriesId: record['seriesId'] } : {}),
    ...(recurrence ? { recurrence } : {}),
  };
}

function tryProject(record: LiveCrmRecord): CalendarEventRecord | undefined {
  try {
    return projectCalendarEvent(record);
  } catch {
    return undefined;
  }
}

function canonicalEvent(draftInput: CalendarEventDraft): LiveCrmRecord {
  const draft = validateCalendarEventDraft(draftInput);
  const timestamp = now();
  const id = `calendar-event-${crypto.randomUUID()}`;
  return {
    id,
    kind: 'calendar_event',
    matterId: draft.contextRef?.matterId ?? 'firm_home',
    createdAt: timestamp,
    createdBy: actor(),
    updatedAt: timestamp,
    updatedBy: actor(),
    source: { origin: 'user', sources: [] },
    deleted: false,
    externalRefs: [],
    schemaVersion: 1,
    title: draft.title,
    ...(draft.notes ? { notes: draft.notes } : {}),
    startUtc: draft.startUtc,
    endUtc: draft.endUtc,
    displayTimezone: draft.displayTimezone,
    allDay: draft.allDay,
    calendarId: draft.calendarId,
    status: 'scheduled',
    ...(draft.contextRef ? { contextRef: draft.contextRef } : {}),
    ...(draft.recurrence ? { recurrence: draft.recurrence, seriesId: id } : {}),
  };
}

function mergeEventPatch(record: LiveCrmRecord, patch: CalendarEventPatch): LiveCrmRecord {
  const current = projectCalendarEvent(record);
  const recurrence = 'recurrence' in patch
    ? patch.recurrence ?? undefined
    : current.recurrence;
  const contextRef = 'contextRef' in patch
    ? patch.contextRef ?? undefined
    : current.contextRef;
  const notes = 'notes' in patch ? patch.notes ?? undefined : current.notes;
  const draft = validateCalendarEventDraft({
    title: patch.title ?? current.title,
    ...(notes !== undefined ? { notes } : {}),
    startUtc: patch.startUtc ?? current.startUtc,
    endUtc: patch.endUtc ?? current.endUtc,
    displayTimezone: patch.displayTimezone ?? current.displayTimezone,
    allDay: patch.allDay ?? current.allDay,
    calendarId: current.calendarId,
    ...(contextRef !== undefined ? { contextRef } : {}),
    ...(recurrence !== undefined ? { recurrence } : {}),
  });

  const next: LiveCrmRecord = {
    ...record,
    updatedAt: now(),
    updatedBy: actor(),
    title: draft.title,
    startUtc: draft.startUtc,
    endUtc: draft.endUtc,
    displayTimezone: draft.displayTimezone,
    allDay: draft.allDay,
  };
  if (draft.notes === undefined) delete next['notes'];
  else next['notes'] = draft.notes;
  if (draft.contextRef === undefined) delete next['contextRef'];
  else next['contextRef'] = draft.contextRef;
  if (draft.recurrence === undefined) {
    delete next['recurrence'];
    delete next['seriesId'];
  } else {
    next['recurrence'] = draft.recurrence;
    next['seriesId'] = typeof record['seriesId'] === 'string' ? record['seriesId'] : record.id;
  }
  return next;
}

export function createCalendarEventStore(port: CalendarLivePort): CalendarEventStore {
  const records = port.records.filter((record) => record.kind === 'calendar_event');
  const events = records.flatMap((record) => {
    const projected = tryProject(record);
    return projected ? [projected] : [];
  });
  const save = async (record: LiveCrmRecord): Promise<CalendarEventRecord> => {
    const saved = await port.save(record);
    await port.reload();
    return projectCalendarEvent(saved);
  };
  return {
    events,
    error: port.error,
    get: (id) => Promise.resolve().then(() => {
      requireAvailable(port);
      const record = records.find((candidate) => candidate.id === id);
      return record ? projectCalendarEvent(record) : undefined;
    }),
    create: (draft) => {
      requireAvailable(port);
      return save(canonicalEvent(draft));
    },
    update: (id, patch) => {
      requireAvailable(port);
      const record = records.find((candidate) => candidate.id === id);
      if (!record) throw new Error('That calendar event no longer exists.');
      return save(mergeEventPatch(record, patch));
    },
    cancel: (id) => {
      requireAvailable(port);
      const record = records.find((candidate) => candidate.id === id);
      if (!record) throw new Error('That calendar event no longer exists.');
      return save({ ...record, status: 'cancelled', updatedAt: now(), updatedBy: actor() });
    },
    listOccurrences: (range: CalendarRange) => Promise.resolve().then(() => {
      requireAvailable(port);
      return expandCalendarEvents(events, range);
    }),
  };
}

/** Reactive adapter over the current canonical encrypted live-record snapshot. */
export function useCalendarEventStore(): CalendarEventStore {
  return createCalendarEventStore(useLiveCrmRecords());
}

export interface CalendarRecordDraftDefaults {
  readonly title?: string;
  readonly startUtc: string;
  readonly endUtc: string;
  readonly displayTimezone: string;
  readonly allDay?: boolean;
  readonly calendarId: string;
}

export function createDraftFromRecord(
  context: CalendarContextReference,
  defaults: CalendarRecordDraftDefaults,
): CalendarEventDraft {
  const cleanContext = validateContextReference(context);
  return validateCalendarEventDraft({
    title: defaults.title ?? (cleanContext.label ? `Meet with ${cleanContext.label}` : 'Client meeting'),
    startUtc: defaults.startUtc,
    endUtc: defaults.endUtc,
    displayTimezone: defaults.displayTimezone,
    allDay: defaults.allDay ?? false,
    calendarId: defaults.calendarId,
    contextRef: cleanContext,
  });
}
