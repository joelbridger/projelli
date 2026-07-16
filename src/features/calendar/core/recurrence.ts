import type {
  CalendarEventRecord,
  CalendarOccurrence,
  CalendarRange,
  CalendarRecurrenceRule,
  CalendarWeekday,
} from './types';
import {
  addLocalDays,
  compareLocalDates,
  daysBetween,
  isValidLocalDate,
  localDateTimeToUtc,
  parseUtc,
  startOfWeek,
  toUtcIso,
  validateCalendarRange,
  weekdayOf,
  zonedParts,
  type LocalDate,
  type LocalDateTime,
} from './time';
import { validateRecurrenceRule } from './validation';

const MAX_EXPANSION_STEPS = 20_000;
const WEEKDAY_OFFSET: Readonly<Record<CalendarWeekday, number>> = {
  monday: 0,
  tuesday: 1,
  wednesday: 2,
  thursday: 3,
  friday: 4,
  saturday: 5,
  sunday: 6,
};

function occurrence(event: CalendarEventRecord, startMs: number, endMs: number): CalendarOccurrence {
  const startUtc = toUtcIso(startMs);
  return {
    occurrenceKey: `${event.seriesId ?? event.id}@${startUtc}`,
    sourceEventId: event.id,
    ...(event.seriesId ? { seriesId: event.seriesId } : {}),
    kind: 'calendar_event',
    title: event.title,
    startUtc,
    endUtc: toUtcIso(endMs),
    displayTimezone: event.displayTimezone,
    allDay: event.allDay,
    calendarId: event.calendarId,
    status: event.status,
    ...(event.contextRef ? { contextRef: event.contextRef } : {}),
  };
}

function monthAt(start: LocalDate, offset: number): { year: number; month: number } {
  const zeroBased = start.year * 12 + start.month - 1 + offset;
  return { year: Math.floor(zeroBased / 12), month: (zeroBased % 12) + 1 };
}

function localCandidates(
  rule: CalendarRecurrenceRule,
  start: LocalDateTime & { weekday: CalendarWeekday },
  bucket: number,
): LocalDateTime[] {
  const time = { hour: start.hour, minute: start.minute, second: start.second };
  if (rule.frequency === 'daily') {
    return [{ ...addLocalDays(start, bucket * rule.interval), ...time }];
  }
  if (rule.frequency === 'weekly') {
    const week = addLocalDays(startOfWeek(start), bucket * rule.interval * 7);
    const weekdays = rule.byWeekday ?? [start.weekday];
    return weekdays
      .map((weekday) => ({ ...addLocalDays(week, WEEKDAY_OFFSET[weekday]), ...time }))
      .sort((left, right) => compareLocalDates(left, right));
  }
  if (rule.frequency === 'monthly') {
    const month = monthAt(start, bucket * rule.interval);
    return (rule.byMonthDay ?? [start.day])
      .map((day) => ({ ...month, day, ...time }))
      .filter(isValidLocalDate)
      .sort((left, right) => left.day - right.day);
  }
  const year = start.year + bucket * rule.interval;
  return (rule.byMonthDay ?? [start.day])
    .map((day) => ({ year, month: start.month, day, ...time }))
    .filter(isValidLocalDate)
    .sort((left, right) => left.day - right.day);
}

function initialBucket(
  rule: CalendarRecurrenceRule,
  start: LocalDateTime & { weekday: CalendarWeekday },
  lookBack: LocalDate,
): number {
  if (rule.count !== undefined) return 0;
  if (rule.frequency === 'daily') {
    return Math.max(0, Math.floor(daysBetween(start, lookBack) / rule.interval) - 1);
  }
  if (rule.frequency === 'weekly') {
    return Math.max(0, Math.floor(daysBetween(startOfWeek(start), startOfWeek(lookBack)) / (7 * rule.interval)) - 1);
  }
  if (rule.frequency === 'monthly') {
    const months = (lookBack.year - start.year) * 12 + lookBack.month - start.month;
    return Math.max(0, Math.floor(months / rule.interval) - 1);
  }
  return Math.max(0, Math.floor((lookBack.year - start.year) / rule.interval) - 1);
}

/**
 * Expand one canonical event inside a required bounded range. Recurrence keeps
 * the event's local wall time and fails rather than shifting a nonexistent DST
 * time or an invalid selector date.
 */
export function expandCalendarEvent(
  event: CalendarEventRecord,
  range: CalendarRange,
): readonly CalendarOccurrence[] {
  const { startMs: rangeStartMs, endMs: rangeEndMs } = validateCalendarRange(range);
  if (event.status === 'cancelled') return [];
  const eventStartMs = parseUtc(event.startUtc, 'Event start');
  const eventEndMs = parseUtc(event.endUtc, 'Event end');
  const durationMs = eventEndMs - eventStartMs;
  if (durationMs <= 0) throw new Error('Calendar event end must be after its start.');
  if (!event.recurrence) {
    return eventStartMs < rangeEndMs && eventEndMs > rangeStartMs
      ? [occurrence(event, eventStartMs, eventEndMs)]
      : [];
  }

  const rule = validateRecurrenceRule(event.recurrence, event.startUtc);
  const localStart = zonedParts(eventStartMs, event.displayTimezone);
  const lookBackLocal = zonedParts(rangeStartMs - durationMs, event.displayTimezone);
  let bucket = initialBucket(rule, localStart, lookBackLocal);
  let ordinal = 0;
  let steps = 0;
  const untilMs = rule.untilUtc === undefined ? Number.POSITIVE_INFINITY : parseUtc(rule.untilUtc, 'Recurrence end');
  const results: CalendarOccurrence[] = [];

  while (steps < MAX_EXPANSION_STEPS) {
    steps += 1;
    const candidates = localCandidates(rule, localStart, bucket);
    let bucketBeyondRange = candidates.length > 0;
    for (const candidate of candidates) {
      const candidateMs = localDateTimeToUtc(candidate, event.displayTimezone);
      if (candidateMs < eventStartMs) continue;
      ordinal += 1;
      if (rule.count !== undefined && ordinal > rule.count) return results;
      if (candidateMs > untilMs) return results;
      if (candidateMs < rangeEndMs) bucketBeyondRange = false;
      const candidateEndMs = candidateMs + durationMs;
      if (candidateMs < rangeEndMs && candidateEndMs > rangeStartMs) {
        results.push(occurrence(event, candidateMs, candidateEndMs));
      }
    }
    if (bucketBeyondRange || (candidates.length === 0 && bucket > initialBucket(rule, localStart, lookBackLocal) + 24)) break;
    bucket += 1;
  }
  if (steps >= MAX_EXPANSION_STEPS) {
    throw new Error('Calendar recurrence expansion exceeded its safety bound.');
  }
  return results;
}

export function expandCalendarEvents(
  events: readonly CalendarEventRecord[],
  range: CalendarRange,
): readonly CalendarOccurrence[] {
  validateCalendarRange(range);
  return events
    .flatMap((event) => expandCalendarEvent(event, range))
    .sort((left, right) => left.startUtc.localeCompare(right.startUtc) || left.occurrenceKey.localeCompare(right.occurrenceKey));
}

export function validateCalendarRecurrence(rule: CalendarRecurrenceRule, startUtc?: string): CalendarRecurrenceRule {
  return validateRecurrenceRule(rule, startUtc);
}

export function weekdayForUtc(value: string, timeZone: string): CalendarWeekday {
  return weekdayOf(zonedParts(parseUtc(value), timeZone));
}
