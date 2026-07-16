import type { CalendarRange, CalendarWeekday } from './types';

export const MINUTE_MS = 60_000;
export const DAY_MS = 24 * 60 * MINUTE_MS;
export const MAX_CALENDAR_RANGE_DAYS = 370;

const UTC_ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const LOCAL_TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const WEEKDAYS: readonly CalendarWeekday[] = [
  'sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday',
];

export interface LocalDate {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

export interface LocalDateTime extends LocalDate {
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
}

export function parseUtc(value: string, label = 'UTC date'): number {
  if (!UTC_ISO.test(value)) throw new Error(`${label} must be a complete UTC ISO timestamp.`);
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(`${label} is invalid.`);
  return parsed;
}

export function toUtcIso(milliseconds: number): string {
  return new Date(milliseconds).toISOString().replace('.000Z', 'Z');
}

export function validateTimeZone(timeZone: string): string {
  const clean = timeZone.trim();
  if (!clean || clean !== timeZone) throw new Error('A valid display timezone is required.');
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: clean }).format(0);
  } catch {
    throw new Error('The display timezone is invalid.');
  }
  return clean;
}

export function validateCalendarRange(range: CalendarRange): { startMs: number; endMs: number } {
  const startMs = parseUtc(range.startUtc, 'Range start');
  const endMs = parseUtc(range.endUtc, 'Range end');
  if (endMs <= startMs) throw new Error('Calendar range end must be after its start.');
  if (endMs - startMs > MAX_CALENDAR_RANGE_DAYS * DAY_MS) {
    throw new Error(`Calendar queries must be bounded to ${String(MAX_CALENDAR_RANGE_DAYS)} days or fewer.`);
  }
  return { startMs, endMs };
}

export function validateLocalTime(value: string, label: string): number {
  if (!LOCAL_TIME.test(value)) throw new Error(`${label} must use 24-hour HH:mm format.`);
  const [hours = '', minutes = ''] = value.split(':');
  return Number(hours) * 60 + Number(minutes);
}

export function zonedParts(milliseconds: number, timeZone: string): LocalDateTime & { weekday: CalendarWeekday } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
    minute: '2-digit',
    second: '2-digit',
    weekday: 'short',
  }).formatToParts(milliseconds);
  const value = (type: Intl.DateTimeFormatPartTypes): string => parts.find((part) => part.type === type)?.value ?? '';
  const weekdayIndex = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(value('weekday'));
  const weekday = WEEKDAYS[weekdayIndex];
  if (!weekday) throw new Error('The local weekday could not be calculated.');
  return {
    year: Number(value('year')),
    month: Number(value('month')),
    day: Number(value('day')),
    hour: Number(value('hour')),
    minute: Number(value('minute')),
    second: Number(value('second')),
    weekday,
  };
}

function sameLocal(left: LocalDateTime, right: LocalDateTime): boolean {
  return left.year === right.year && left.month === right.month && left.day === right.day &&
    left.hour === right.hour && left.minute === right.minute && left.second === right.second;
}

/** Convert a real local wall time to UTC without silently repairing DST gaps. */
export function localDateTimeToUtc(local: LocalDateTime, timeZone: string): number {
  const guess = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, local.second);
  if (!isValidLocalDate(local)) throw new Error('The recurrence produced an invalid calendar date.');
  let candidate = guess;
  for (let index = 0; index < 5; index += 1) {
    const observed = zonedParts(candidate, timeZone);
    const observedAsUtc = Date.UTC(
      observed.year, observed.month - 1, observed.day, observed.hour, observed.minute, observed.second,
    );
    candidate += guess - observedAsUtc;
  }
  if (!sameLocal(zonedParts(candidate, timeZone), local)) {
    throw new Error('The recurrence produced a local time that does not exist in its timezone.');
  }
  return candidate;
}

export function isValidLocalDate(local: Pick<LocalDate, 'year' | 'month' | 'day'>): boolean {
  const date = new Date(Date.UTC(local.year, local.month - 1, local.day));
  return date.getUTCFullYear() === local.year && date.getUTCMonth() + 1 === local.month && date.getUTCDate() === local.day;
}

export function addLocalDays(local: LocalDate, days: number): LocalDate {
  const date = new Date(Date.UTC(local.year, local.month - 1, local.day + days));
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

export function daysBetween(left: LocalDate, right: LocalDate): number {
  return Math.floor((Date.UTC(right.year, right.month - 1, right.day) - Date.UTC(left.year, left.month - 1, left.day)) / DAY_MS);
}

export function compareLocalDates(left: LocalDate, right: LocalDate): number {
  return Date.UTC(left.year, left.month - 1, left.day) - Date.UTC(right.year, right.month - 1, right.day);
}

export function weekdayOf(local: LocalDate): CalendarWeekday {
  const weekday = WEEKDAYS[new Date(Date.UTC(local.year, local.month - 1, local.day)).getUTCDay()];
  if (!weekday) throw new Error('The local weekday could not be calculated.');
  return weekday;
}

export function startOfWeek(local: LocalDate): LocalDate {
  const weekday = new Date(Date.UTC(local.year, local.month - 1, local.day)).getUTCDay();
  const mondayOffset = weekday === 0 ? -6 : 1 - weekday;
  return addLocalDays(local, mondayOffset);
}

export function localDateKey(local: LocalDate): string {
  return `${String(local.year).padStart(4, '0')}-${String(local.month).padStart(2, '0')}-${String(local.day).padStart(2, '0')}`;
}
