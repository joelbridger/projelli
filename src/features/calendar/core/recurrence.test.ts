import { describe, expect, it } from 'vitest';
import { expandCalendarEvent, validateCalendarRecurrence } from './recurrence';
import { validateCalendarEventDraft } from './validation';
import type { CalendarEventRecord } from './types';

function event(overrides: Partial<CalendarEventRecord> = {}): CalendarEventRecord {
  return {
    id: 'event-1',
    kind: 'calendar_event',
    title: 'Review',
    startUtc: '2026-03-02T14:00:00Z',
    endUtc: '2026-03-02T14:30:00Z',
    displayTimezone: 'America/New_York',
    allDay: false,
    calendarId: 'calendar:local',
    status: 'scheduled',
    ...overrides,
  };
}

describe('calendar recurrence', () => {
  it('keeps weekly wall time across daylight saving and returns stable ordered keys', () => {
    const occurrences = expandCalendarEvent(event({
      seriesId: 'event-1',
      recurrence: { frequency: 'weekly', interval: 1, byWeekday: ['monday', 'wednesday'] },
    }), {
      startUtc: '2026-03-08T00:00:00Z',
      endUtc: '2026-03-16T00:00:00Z',
    });

    expect(occurrences.map((item) => item.startUtc)).toEqual([
      '2026-03-09T13:00:00Z',
      '2026-03-11T13:00:00Z',
    ]);
    expect(occurrences[0]?.occurrenceKey).toBe('event-1@2026-03-09T13:00:00Z');
  });

  it('supports daily count, monthly selectors, yearly selectors, and cancellation', () => {
    expect(expandCalendarEvent(event({
      recurrence: { frequency: 'daily', interval: 2, count: 3 },
    }), { startUtc: '2026-03-01T00:00:00Z', endUtc: '2026-03-20T00:00:00Z' })).toHaveLength(3);

    const monthly = event({
      startUtc: '2026-01-31T15:00:00Z',
      endUtc: '2026-01-31T15:30:00Z',
      displayTimezone: 'UTC',
      recurrence: { frequency: 'monthly', interval: 1, byMonthDay: [31] },
    });
    expect(expandCalendarEvent(monthly, {
      startUtc: '2026-01-01T00:00:00Z', endUtc: '2026-05-01T00:00:00Z',
    }).map((item) => item.startUtc)).toEqual(['2026-01-31T15:00:00Z', '2026-03-31T15:00:00Z']);

    const yearly = event({
      startUtc: '2024-02-29T15:00:00Z',
      endUtc: '2024-02-29T15:30:00Z',
      displayTimezone: 'UTC',
      recurrence: { frequency: 'yearly', interval: 1, byMonthDay: [29] },
    });
    expect(expandCalendarEvent(yearly, {
      startUtc: '2027-08-01T00:00:00Z', endUtc: '2028-07-31T00:00:00Z',
    }).map((item) => item.startUtc)).toEqual(['2028-02-29T15:00:00Z']);
    expect(expandCalendarEvent(event({ status: 'cancelled' }), {
      startUtc: '2026-03-01T00:00:00Z', endUtc: '2026-03-10T00:00:00Z',
    })).toEqual([]);
  });

  it('rejects malformed dates, zones, ranges, duplicate selectors, and unbounded queries', () => {
    expect(() => validateCalendarEventDraft({
      title: 'Bad', startUtc: 'tomorrow', endUtc: '2026-03-02T15:00:00Z',
      displayTimezone: 'UTC', allDay: false, calendarId: 'calendar:local',
    })).toThrow(/UTC ISO/);
    expect(() => validateCalendarEventDraft({
      title: 'Bad', startUtc: '2026-03-02T15:00:00Z', endUtc: '2026-03-02T14:00:00Z',
      displayTimezone: 'Mars/Olympus', allDay: false, calendarId: 'calendar:local',
    })).toThrow(/end must be after/);
    expect(() => validateCalendarEventDraft({
      title: 'Bad', startUtc: '2026-03-02T14:00:00Z', endUtc: '2026-03-02T15:00:00Z',
      displayTimezone: 'Mars/Olympus', allDay: false, calendarId: 'calendar:local',
    })).toThrow(/timezone/);
    expect(() => validateCalendarRecurrence({ frequency: 'weekly', interval: 1, byWeekday: ['monday', 'monday'] })).toThrow(/duplicated/);
    expect(() => validateCalendarRecurrence({ frequency: 'monthly', interval: 1, byMonthDay: [32] })).toThrow(/1 through 31/);
    expect(() => validateCalendarRecurrence({ frequency: 'daily', interval: 0 })).toThrow(/positive/);
    expect(() => expandCalendarEvent(event(), {
      startUtc: '2026-01-01T00:00:00Z', endUtc: '2028-01-01T00:00:00Z',
    })).toThrow(/bounded/);
  });
});
