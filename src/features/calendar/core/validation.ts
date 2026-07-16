import {
  CALENDAR_WEEKDAYS,
  type CalendarContextReference,
  type CalendarEventDraft,
  type CalendarRecurrenceRule,
} from './types';
import { parseUtc, validateTimeZone } from './time';

const MAX_NOTES_LENGTH = 20_000;
const MAX_RECURRENCE_COUNT = 10_000;

function cleanRequired(value: string, label: string): string {
  const clean = value.trim();
  if (!clean || clean !== value) throw new Error(`${label} must be a stable non-empty value.`);
  return clean;
}

export function validateContextReference(value: CalendarContextReference): CalendarContextReference {
  const kind: unknown = value.kind;
  if (kind !== 'household' && kind !== 'record') {
    throw new Error('Calendar context kind is invalid.');
  }
  const id = cleanRequired(value.id, 'Calendar context ID');
  const matterId = value.matterId === undefined ? undefined : cleanRequired(value.matterId, 'Calendar context matter ID');
  const label = value.label?.trim() || undefined;
  return {
    kind: value.kind,
    id,
    ...(matterId ? { matterId } : {}),
    ...(label ? { label } : {}),
  };
}

export function validateRecurrenceRule(
  value: CalendarRecurrenceRule,
  eventStartUtc?: string,
): CalendarRecurrenceRule {
  if (!['daily', 'weekly', 'monthly', 'yearly'].includes(value.frequency)) {
    throw new Error('Calendar recurrence frequency is invalid.');
  }
  if (!Number.isInteger(value.interval) || value.interval < 1 || value.interval > 1_000) {
    throw new Error('Calendar recurrence interval must be a positive whole number no greater than 1000.');
  }
  if (value.count !== undefined && value.untilUtc !== undefined) {
    throw new Error('Calendar recurrence may use a count or an end date, not both.');
  }
  if (value.count !== undefined && (!Number.isInteger(value.count) || value.count < 1 || value.count > MAX_RECURRENCE_COUNT)) {
    throw new Error(`Calendar recurrence count must be between 1 and ${String(MAX_RECURRENCE_COUNT)}.`);
  }
  if (value.untilUtc !== undefined) {
    const untilMs = parseUtc(value.untilUtc, 'Recurrence end');
    if (eventStartUtc !== undefined && untilMs < parseUtc(eventStartUtc, 'Event start')) {
      throw new Error('Calendar recurrence end cannot be before the event starts.');
    }
  }

  const byWeekday = value.byWeekday === undefined ? undefined : [...value.byWeekday];
  if (byWeekday !== undefined) {
    if (value.frequency !== 'weekly' || byWeekday.length === 0) {
      throw new Error('Weekday selectors are supported only for weekly recurrence.');
    }
    if (byWeekday.some((weekday) => !CALENDAR_WEEKDAYS.includes(weekday))) {
      throw new Error('Calendar recurrence weekday selector is invalid.');
    }
    if (new Set(byWeekday).size !== byWeekday.length) {
      throw new Error('Calendar recurrence weekday selectors must not be duplicated.');
    }
  }

  const byMonthDay = value.byMonthDay === undefined ? undefined : [...value.byMonthDay];
  if (byMonthDay !== undefined) {
    if ((value.frequency !== 'monthly' && value.frequency !== 'yearly') || byMonthDay.length === 0) {
      throw new Error('Month-day selectors are supported only for monthly or yearly recurrence.');
    }
    if (byMonthDay.some((day) => !Number.isInteger(day) || day < 1 || day > 31)) {
      throw new Error('Calendar recurrence month-day selectors must be whole numbers from 1 through 31.');
    }
    if (new Set(byMonthDay).size !== byMonthDay.length) {
      throw new Error('Calendar recurrence month-day selectors must not be duplicated.');
    }
  }

  return {
    frequency: value.frequency,
    interval: value.interval,
    ...(value.count !== undefined ? { count: value.count } : {}),
    ...(value.untilUtc !== undefined ? { untilUtc: value.untilUtc } : {}),
    ...(byWeekday ? { byWeekday } : {}),
    ...(byMonthDay ? { byMonthDay } : {}),
  };
}

export function validateCalendarEventDraft(value: CalendarEventDraft): CalendarEventDraft {
  const title = value.title.trim();
  if (!title) throw new Error('A calendar event title is required.');
  const notes = value.notes?.trim() || undefined;
  if (notes && notes.length > MAX_NOTES_LENGTH) throw new Error('Calendar event notes are too long.');
  const startMs = parseUtc(value.startUtc, 'Event start');
  const endMs = parseUtc(value.endUtc, 'Event end');
  if (endMs <= startMs) throw new Error('Calendar event end must be after its start.');
  const displayTimezone = validateTimeZone(value.displayTimezone);
  const calendarId = cleanRequired(value.calendarId, 'Calendar ID');
  const contextRef = value.contextRef === undefined ? undefined : validateContextReference(value.contextRef);
  const recurrence = value.recurrence === undefined
    ? undefined
    : validateRecurrenceRule(value.recurrence, value.startUtc);
  return {
    title,
    ...(notes ? { notes } : {}),
    startUtc: value.startUtc,
    endUtc: value.endUtc,
    displayTimezone,
    allDay: value.allDay,
    calendarId,
    ...(contextRef ? { contextRef } : {}),
    ...(recurrence ? { recurrence } : {}),
  };
}
