import type {
  AvailabilityRule,
  BookableSlot,
  BusyFreeSnapshot,
  MeetingType,
  Weekday,
} from './types';

const SLOT_INTERVAL_MIN = 15;
const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;

interface LocalDate {
  year: number;
  month: number;
  day: number;
}

interface LocalDateTimeParts extends LocalDate {
  hour: number;
  minute: number;
  second: number;
  weekday: Weekday;
}

interface LocalTime {
  hour: number;
  minute: number;
}

interface BusyBlockMs {
  startMs: number;
  endMs: number;
}

export interface AvailabilitySearchInput {
  rule: AvailabilityRule;
  busyFreeSnapshot: BusyFreeSnapshot;
  rangeStartUtc: string;
  rangeEndUtc: string;
  advisorTimezone: string;
  nowUtc?: string;
  meetingTypeId?: string;
}

export interface ZonedSlotLabel {
  date: string;
  time: string;
  weekday: Weekday;
  timezone: string;
}

export function computeOpenSlots(input: AvailabilitySearchInput): BookableSlot[] {
  try {
    assertUsableTimeZone(input.advisorTimezone);
    const rangeStartMs = parseUtcMs(input.rangeStartUtc);
    const rangeEndMs = parseUtcMs(input.rangeEndUtc);
    const nowMs = parseUtcMs(input.nowUtc ?? new Date().toISOString());
    if (rangeStartMs === null || rangeEndMs === null || nowMs === null || rangeEndMs <= rangeStartMs) {
      return [];
    }

    const meetingTypes = input.meetingTypeId
      ? input.rule.meetingTypes.filter((type) => type.id === input.meetingTypeId)
      : input.rule.meetingTypes;
    if (meetingTypes.length === 0) return [];

    const noticeCutoffMs = nowMs + Math.max(0, input.rule.minNoticeHours) * 60 * MINUTE_MS;
    const horizonCutoffMs = nowMs + Math.max(0, input.rule.maxHorizonDays) * DAY_MS;
    const busyBlocks = normalizeBusyBlocks(input.busyFreeSnapshot);
    const localStart = addLocalDays(utcToLocalDate(rangeStartMs, input.advisorTimezone), -1);
    const localEnd = addLocalDays(utcToLocalDate(rangeEndMs, input.advisorTimezone), 1);
    const slots: BookableSlot[] = [];

    for (
      let date = localStart;
      compareLocalDates(date, localEnd) <= 0;
      date = addLocalDays(date, 1)
    ) {
      const weekday = weekdayForLocalDate(date);
      const periods = input.rule.workingHours[weekday];
      for (const period of periods) {
        const workStart = localTimeToUtcMs(date, period.startLocal, input.advisorTimezone);
        const workEnd = localTimeToUtcMs(date, period.endLocal, input.advisorTimezone);
        if (workStart === null || workEnd === null || workEnd <= workStart) continue;

        for (const meetingType of meetingTypes) {
          slots.push(
            ...slotsForMeetingType({
              meetingType,
              advisorTimezone: input.advisorTimezone,
              workStartMs: workStart,
              workEndMs: workEnd,
              rangeStartMs,
              rangeEndMs,
              noticeCutoffMs,
              horizonCutoffMs,
              busyBlocks,
            }),
          );
        }
      }
    }

    return slots.sort((a, b) => {
      const byStart = a.startUtc.localeCompare(b.startUtc);
      if (byStart !== 0) return byStart;
      return a.meetingTypeId.localeCompare(b.meetingTypeId);
    });
  } catch {
    return [];
  }
}

export function formatSlotInTimeZone(slot: BookableSlot, timezone: string): ZonedSlotLabel {
  assertUsableTimeZone(timezone);
  const startMs = parseUtcMs(slot.startUtc);
  if (startMs === null) {
    throw new Error('Invalid slot start time.');
  }
  const parts = getZonedParts(startMs, timezone);
  return {
    date: `${String(parts.year).padStart(4, '0')}-${pad2(parts.month)}-${pad2(parts.day)}`,
    time: `${pad2(parts.hour)}:${pad2(parts.minute)}`,
    weekday: parts.weekday,
    timezone,
  };
}

function slotsForMeetingType({
  meetingType,
  advisorTimezone,
  workStartMs,
  workEndMs,
  rangeStartMs,
  rangeEndMs,
  noticeCutoffMs,
  horizonCutoffMs,
  busyBlocks,
}: {
  meetingType: MeetingType;
  advisorTimezone: string;
  workStartMs: number;
  workEndMs: number;
  rangeStartMs: number;
  rangeEndMs: number;
  noticeCutoffMs: number;
  horizonCutoffMs: number;
  busyBlocks: BusyBlockMs[];
}): BookableSlot[] {
  const durationMs = meetingType.durationMin * MINUTE_MS;
  if (!Number.isFinite(durationMs) || durationMs <= 0) return [];

  const searchStart = Math.max(workStartMs, rangeStartMs, noticeCutoffMs);
  const searchEnd = Math.min(workEndMs, rangeEndMs, horizonCutoffMs);
  const firstStart = roundUpToInterval(searchStart, SLOT_INTERVAL_MIN * MINUTE_MS);
  const slots: BookableSlot[] = [];

  for (let startMs = firstStart; startMs + durationMs <= searchEnd; startMs += SLOT_INTERVAL_MIN * MINUTE_MS) {
    const endMs = startMs + durationMs;
    if (endMs > workEndMs || startMs < workStartMs) continue;
    const blockedStartMs = startMs - Math.max(0, meetingType.bufferBeforeMin) * MINUTE_MS;
    const blockedEndMs = endMs + Math.max(0, meetingType.bufferAfterMin) * MINUTE_MS;
    if (busyBlocks.some((busy) => intervalsOverlap(blockedStartMs, blockedEndMs, busy.startMs, busy.endMs))) {
      continue;
    }
    slots.push({
      meetingTypeId: meetingType.id,
      meetingTypeName: meetingType.name,
      startUtc: toUtcIso(startMs),
      endUtc: toUtcIso(endMs),
      advisorTimezone,
      durationMin: meetingType.durationMin,
    });
  }

  return slots;
}

function normalizeBusyBlocks(snapshot: BusyFreeSnapshot): BusyBlockMs[] {
  return snapshot.busy
    .map((block) => ({
      startMs: parseUtcMs(block.startUtc),
      endMs: parseUtcMs(block.endUtc),
    }))
    .filter((block): block is BusyBlockMs =>
      block.startMs !== null && block.endMs !== null && block.endMs > block.startMs,
    )
    .sort((a, b) => a.startMs - b.startMs);
}

function parseUtcMs(value: string): number | null {
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function toUtcIso(ms: number): string {
  return new Date(ms).toISOString().replace('.000Z', 'Z');
}

function intervalsOverlap(startA: number, endA: number, startB: number, endB: number): boolean {
  return startA < endB && endA > startB;
}

function roundUpToInterval(ms: number, intervalMs: number): number {
  return Math.ceil(ms / intervalMs) * intervalMs;
}

function localTimeToUtcMs(date: LocalDate, time: string, timezone: string): number | null {
  const parsed = parseLocalTime(time);
  if (!parsed) return null;
  return zonedLocalToUtcMs(date, parsed, timezone);
}

function parseLocalTime(time: string): LocalTime | null {
  const match = /^(\d{2}):(\d{2})$/.exec(time);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return { hour, minute };
}

function zonedLocalToUtcMs(date: LocalDate, time: LocalTime, timezone: string): number {
  const localAsUtcMs = Date.UTC(date.year, date.month - 1, date.day, time.hour, time.minute, 0, 0);
  let utcMs = localAsUtcMs;
  for (let i = 0; i < 4; i += 1) {
    utcMs = localAsUtcMs - getTimeZoneOffsetMs(utcMs, timezone);
  }
  return utcMs;
}

function getTimeZoneOffsetMs(utcMs: number, timezone: string): number {
  const parts = getZonedParts(utcMs, timezone);
  const localAsUtcMs = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
    0,
  );
  return localAsUtcMs - utcMs;
}

function utcToLocalDate(utcMs: number, timezone: string): LocalDate {
  const parts = getZonedParts(utcMs, timezone);
  return { year: parts.year, month: parts.month, day: parts.day };
}

function getZonedParts(utcMs: number, timezone: string): LocalDateTimeParts {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'long',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const parts = formatter.formatToParts(new Date(utcMs));
  const byType = new Map(parts.map((part) => [part.type, part.value]));
  const weekday = (byType.get('weekday') ?? '').toLowerCase() as Weekday;
  return {
    year: Number(byType.get('year')),
    month: Number(byType.get('month')),
    day: Number(byType.get('day')),
    hour: Number(byType.get('hour')),
    minute: Number(byType.get('minute')),
    second: Number(byType.get('second')),
    weekday,
  };
}

function addLocalDays(date: LocalDate, days: number): LocalDate {
  const ms = Date.UTC(date.year, date.month - 1, date.day + days, 12, 0, 0, 0);
  const shifted = new Date(ms);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

function compareLocalDates(a: LocalDate, b: LocalDate): number {
  const aMs = Date.UTC(a.year, a.month - 1, a.day);
  const bMs = Date.UTC(b.year, b.month - 1, b.day);
  return aMs - bMs;
}

function weekdayForLocalDate(date: LocalDate): Weekday {
  const ms = Date.UTC(date.year, date.month - 1, date.day, 12, 0, 0, 0);
  switch (new Date(ms).getUTCDay()) {
    case 0:
      return 'sunday';
    case 1:
      return 'monday';
    case 2:
      return 'tuesday';
    case 3:
      return 'wednesday';
    case 4:
      return 'thursday';
    case 5:
      return 'friday';
    default:
      return 'saturday';
  }
}

function assertUsableTimeZone(timezone: string): void {
  new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(new Date());
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}
