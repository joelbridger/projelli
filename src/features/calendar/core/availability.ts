import type {
  BookingAvailabilityRecord,
  CalendarBookableSlot,
  CalendarCapabilityState,
  CalendarOccurrence,
  CalendarRange,
  CalendarReadProjection,
  OpaqueCalendarBusyBlock,
} from './types';
import {
  DAY_MS,
  MINUTE_MS,
  addLocalDays,
  compareLocalDates,
  localDateTimeToUtc,
  parseUtc,
  toUtcIso,
  validateCalendarRange,
  validateLocalTime,
  zonedParts,
} from './time';
import { validateBookingAvailabilityDraft } from './settingsStores';

const SLOT_STEP_MINUTES = 15;

export interface BusyBlockOptions {
  readonly capability: CalendarCapabilityState;
  readonly localOccurrences: readonly CalendarOccurrence[];
  readonly externalReadProjections?: readonly CalendarReadProjection[];
}

/** Strip display/private data while selecting only calendars declared as busy blockers. */
export function getBusyBlocks(
  range: CalendarRange,
  options: BusyBlockOptions,
): readonly OpaqueCalendarBusyBlock[] {
  const { startMs, endMs } = validateCalendarRange(range);
  const blocking = new Set(options.capability.busyCalendarIds);
  const projections: readonly Pick<CalendarReadProjection, 'calendarId' | 'startUtc' | 'endUtc' | 'status'>[] = [
    ...options.localOccurrences,
    ...(options.externalReadProjections ?? []),
  ];
  const seen = new Set<string>();
  return projections.flatMap((projection) => {
    if (!blocking.has(projection.calendarId) || projection.status === 'cancelled') return [];
    const blockStart = parseUtc(projection.startUtc, 'Busy block start');
    const blockEnd = parseUtc(projection.endUtc, 'Busy block end');
    if (blockEnd <= blockStart) throw new Error('Busy block end must be after its start.');
    if (blockStart >= endMs || blockEnd <= startMs) return [];
    const block = {
      startUtc: toUtcIso(Math.max(blockStart, startMs)),
      endUtc: toUtcIso(Math.min(blockEnd, endMs)),
      calendarId: projection.calendarId,
    };
    const key = `${block.calendarId}|${block.startUtc}|${block.endUtc}`;
    if (seen.has(key)) return [];
    seen.add(key);
    return [block];
  }).sort((left, right) => left.startUtc.localeCompare(right.startUtc) || left.calendarId.localeCompare(right.calendarId));
}

export interface BookableSlotInput {
  readonly availability: BookingAvailabilityRecord;
  readonly range: CalendarRange;
  readonly busyBlocks: readonly OpaqueCalendarBusyBlock[];
  readonly meetingTypeId?: string;
  readonly nowUtc?: string;
}

interface NumericBusyBlock {
  readonly startMs: number;
  readonly endMs: number;
}

function overlaps(startA: number, endA: number, startB: number, endB: number): boolean {
  return startA < endB && endA > startB;
}

function roundUp(value: number, interval: number): number {
  return Math.ceil(value / interval) * interval;
}

export function getBookableSlots(input: BookableSlotInput): readonly CalendarBookableSlot[] {
  const { startMs: requestedStartMs, endMs: requestedEndMs } = validateCalendarRange(input.range);
  const availability = validateBookingAvailabilityDraft(input.availability);
  const nowMs = parseUtc(input.nowUtc ?? new Date().toISOString(), 'Current time');
  const noticeCutoff = nowMs + availability.minimumNoticeMinutes * MINUTE_MS;
  const horizonCutoff = nowMs + availability.maximumHorizonDays * DAY_MS;
  const rangeStartMs = Math.max(requestedStartMs, noticeCutoff);
  const rangeEndMs = Math.min(requestedEndMs, horizonCutoff);
  if (rangeEndMs <= rangeStartMs) return [];

  const meetingTypes = input.meetingTypeId === undefined
    ? availability.meetingTypes
    : availability.meetingTypes.filter((meetingType) => meetingType.id === input.meetingTypeId);
  if (meetingTypes.length === 0) return [];
  const busyBlocks: NumericBusyBlock[] = input.busyBlocks.map((block) => {
    const startMs = parseUtc(block.startUtc, 'Busy block start');
    const endMs = parseUtc(block.endUtc, 'Busy block end');
    if (endMs <= startMs) throw new Error('Busy block end must be after its start.');
    return { startMs, endMs };
  });

  const localStart = addLocalDays(zonedParts(rangeStartMs, availability.advisorTimezone), -1);
  const localEnd = addLocalDays(zonedParts(rangeEndMs, availability.advisorTimezone), 1);
  const slots: CalendarBookableSlot[] = [];
  for (let localDate = localStart; compareLocalDates(localDate, localEnd) <= 0; localDate = addLocalDays(localDate, 1)) {
    const weekday = zonedParts(
      localDateTimeToUtc({ ...localDate, hour: 12, minute: 0, second: 0 }, availability.advisorTimezone),
      availability.advisorTimezone,
    ).weekday;
    for (const window of availability.workingHours[weekday]) {
      const startMinute = validateLocalTime(window.startLocal, `${weekday} start`);
      const endMinute = validateLocalTime(window.endLocal, `${weekday} end`);
      const workStartMs = localDateTimeToUtc({
        ...localDate,
        hour: Math.floor(startMinute / 60),
        minute: startMinute % 60,
        second: 0,
      }, availability.advisorTimezone);
      const workEndMs = localDateTimeToUtc({
        ...localDate,
        hour: Math.floor(endMinute / 60),
        minute: endMinute % 60,
        second: 0,
      }, availability.advisorTimezone);
      for (const meetingType of meetingTypes) {
        const durationMs = meetingType.durationMinutes * MINUTE_MS;
        const firstStart = roundUp(Math.max(workStartMs, rangeStartMs), SLOT_STEP_MINUTES * MINUTE_MS);
        const lastEnd = Math.min(workEndMs, rangeEndMs);
        for (let slotStart = firstStart; slotStart + durationMs <= lastEnd; slotStart += SLOT_STEP_MINUTES * MINUTE_MS) {
          const slotEnd = slotStart + durationMs;
          const blockedStart = slotStart - meetingType.bufferBeforeMinutes * MINUTE_MS;
          const blockedEnd = slotEnd + meetingType.bufferAfterMinutes * MINUTE_MS;
          if (busyBlocks.some((block) => overlaps(blockedStart, blockedEnd, block.startMs, block.endMs))) continue;
          const startUtc = toUtcIso(slotStart);
          slots.push({
            id: `${meetingType.id}@${startUtc}`,
            meetingTypeId: meetingType.id,
            startUtc,
            endUtc: toUtcIso(slotEnd),
            advisorTimezone: availability.advisorTimezone,
          });
        }
      }
    }
  }
  return slots.sort((left, right) => left.startUtc.localeCompare(right.startUtc) || left.meetingTypeId.localeCompare(right.meetingTypeId));
}
