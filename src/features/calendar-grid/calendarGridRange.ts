import type { CalendarRange } from '@/features/calendar';

export type CalendarGridView = 'month' | 'week' | 'day';

const DAY_MS = 24 * 60 * 60 * 1000;

function startOfUtcDay(value: Date): Date {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

/** Every view asks the foundation for a finite interval; recurrence stays there. */
export function calendarGridRange(view: CalendarGridView, now = new Date()): CalendarRange {
  const day = startOfUtcDay(now);
  if (view === 'day') {
    return { startUtc: day.toISOString(), endUtc: new Date(day.getTime() + DAY_MS).toISOString() };
  }
  if (view === 'week') {
    const mondayOffset = (day.getUTCDay() + 6) % 7;
    const monday = new Date(day.getTime() - mondayOffset * DAY_MS);
    return { startUtc: monday.toISOString(), endUtc: new Date(monday.getTime() + 7 * DAY_MS).toISOString() };
  }
  const month = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), 1));
  return {
    startUtc: month.toISOString(),
    endUtc: new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 1)).toISOString(),
  };
}
