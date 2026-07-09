import {
  calendarListEvents,
  type CalendarEventDto,
} from '@/platform/utils/calendar-commands';
import type { BusyFreeSnapshot, OpaqueBusyBlock } from './types';

type CalendarEventLoader = (fromUtc: string, toUtc: string) => Promise<CalendarEventDto[]>;

export function buildBusyFreeSnapshotFromCalendarEvents(
  events: CalendarEventDto[],
): BusyFreeSnapshot {
  const busy = events
    .filter((event) => event.isCancelled !== true && event.selfDeclined !== true)
    .map((event): OpaqueBusyBlock | null => {
      const startMs = Date.parse(event.startUtc);
      const endMs = Date.parse(event.endUtc);
      if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
        return null;
      }
      return {
        startUtc: toUtcIso(startMs),
        endUtc: toUtcIso(endMs),
      };
    })
    .filter((block): block is OpaqueBusyBlock => block !== null)
    .sort((a, b) => a.startUtc.localeCompare(b.startUtc));

  return { busy };
}

export async function loadBusyFreeSnapshotFromCalendarStore(
  fromUtc: string,
  toUtc: string,
  loadEvents: CalendarEventLoader = calendarListEvents,
): Promise<BusyFreeSnapshot> {
  const events = await loadEvents(fromUtc, toUtc);
  return buildBusyFreeSnapshotFromCalendarEvents(events);
}

function toUtcIso(ms: number): string {
  return new Date(ms).toISOString().replace('.000Z', 'Z');
}
