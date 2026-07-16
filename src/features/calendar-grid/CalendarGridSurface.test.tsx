import '@/i18n';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { CalendarOccurrence, CalendarRange } from '@/features/calendar';
import type { SchedulingSurfaceRuntime } from '@/platform/calendar';

const runtime = vi.hoisted(() => ({
  enabled: false,
  listOccurrences: vi.fn<(range: CalendarRange) => Promise<readonly CalendarOccurrence[]>>(),
  useCalendarEventStore: vi.fn(),
}));

vi.mock('@/platform/flags', () => ({ useFlag: () => runtime.enabled }));
vi.mock('@/platform/flags/router', () => ({ isEnabled: () => runtime.enabled }));
vi.mock('@/features/calendar', () => ({ useCalendarEventStore: runtime.useCalendarEventStore }));

import { CalendarGridSurface } from './CalendarGridSurface';
import { calendarGridRange } from './calendarGridRange';
import { calendarGridSchedulingSurface } from './calendarGridContribution';

const occurrence = (overrides: Partial<CalendarOccurrence> = {}): CalendarOccurrence => ({
  occurrenceKey: 'event-1@2026-08-04T09:00:00Z',
  sourceEventId: 'event-1',
  kind: 'calendar_event',
  title: 'Planning call',
  startUtc: '2026-08-04T09:00:00Z',
  endUtc: '2026-08-04T09:30:00Z',
  displayTimezone: 'UTC',
  allDay: false,
  calendarId: 'calendar:local',
  status: 'scheduled',
  ...overrides,
});

const schedulingRuntime = {
  state: {
    availabilityRule: { workingHours: { monday: [], tuesday: [], wednesday: [], thursday: [], friday: [], saturday: [], sunday: [] }, meetingTypes: [], minNoticeHours: 0, maxHorizonDays: 1 },
    bookingSlug: { slug: '', enabled: false }, bookingRequests: [],
    setBookingSlug: () => {}, setDayEnabled: () => {}, updateWorkingHours: () => {}, addMeetingType: () => 'id',
    updateMeetingType: () => {}, removeMeetingType: () => {}, confirmBookingRequest: () => {}, declineBookingRequest: () => {}, setMinNoticeHours: () => {}, setMaxHorizonDays: () => {},
  },
} satisfies SchedulingSurfaceRuntime;

describe('CalendarGridSurface', () => {
  beforeEach(() => {
    runtime.enabled = false;
    runtime.listOccurrences.mockReset();
    runtime.listOccurrences.mockResolvedValue([]);
    runtime.useCalendarEventStore.mockReset();
    runtime.useCalendarEventStore.mockImplementation(() => ({ events: [], listOccurrences: runtime.listOccurrences }));
  });

  it('stays fully inert while dark, without a calendar hook, query, descriptor child, or layout', () => {
    render(<CalendarGridSurface />);

    expect(screen.queryByTestId('calendar-grid')).toBeNull();
    expect(runtime.useCalendarEventStore).not.toHaveBeenCalled();
    expect(runtime.listOccurrences).not.toHaveBeenCalled();
    expect(calendarGridSchedulingSurface.mount(schedulingRuntime)).toBeNull();
  });

  it('shows chronological one-time and recurring occurrences with their stable public keys', async () => {
    runtime.enabled = true;
    const recurring = occurrence({
      occurrenceKey: 'series-1@2026-08-05T10:00:00Z',
      sourceEventId: 'series-1',
      seriesId: 'series-1',
      title: 'Recurring review',
      startUtc: '2026-08-05T10:00:00Z',
      endUtc: '2026-08-05T10:30:00Z',
    });
    const oneTime = occurrence({ title: 'One-time planning' });
    runtime.listOccurrences.mockResolvedValue([recurring, oneTime]);

    render(<CalendarGridSurface />);

    await waitFor(() => { expect(screen.getByTestId(`calendar-occurrence-${oneTime.occurrenceKey}`)).toBeTruthy(); });
    const buttons = screen.getAllByRole('button').filter((button) => button.dataset['testid']?.startsWith('calendar-occurrence-'));
    expect(buttons.map((button) => button.dataset['testid'])).toEqual([
      `calendar-occurrence-${oneTime.occurrenceKey}`,
      `calendar-occurrence-${recurring.occurrenceKey}`,
    ]);
    expect(runtime.listOccurrences).toHaveBeenCalledTimes(1);
    const range = runtime.listOccurrences.mock.calls[0]?.[0];
    if (!range) throw new Error('Expected the month occurrence range.');
    expect(Date.parse(range.endUtc) - Date.parse(range.startUtc)).toBeLessThanOrEqual(31 * 24 * 60 * 60 * 1000);
  });

  it('uses the same read-only occurrence for the selected rail, including a cancelled event', async () => {
    runtime.enabled = true;
    const scheduled = occurrence();
    const cancelled = occurrence({
      occurrenceKey: 'event-2@2026-08-06T11:00:00Z',
      sourceEventId: 'event-2',
      title: 'Cancelled review',
      startUtc: '2026-08-06T11:00:00Z',
      endUtc: '2026-08-06T11:30:00Z',
      status: 'cancelled',
    });
    runtime.listOccurrences.mockResolvedValue([scheduled, cancelled]);

    render(<CalendarGridSurface />);

    await waitFor(() => { expect(screen.getByTestId(`calendar-occurrence-${scheduled.occurrenceKey}`)).toBeTruthy(); });
    fireEvent.click(screen.getByTestId(`calendar-occurrence-${cancelled.occurrenceKey}`));
    expect(screen.getByTestId('calendar-grid-selection').textContent).toContain('Cancelled review');
    expect(screen.getByTestId('calendar-grid-selection').textContent).toContain('calendar:local');
    expect(screen.getByTestId('calendar-grid-selection-status').textContent).toContain('Cancelled');
    expect(runtime.listOccurrences).toHaveBeenCalledTimes(1);
  });

  it('moves only among finite month, week, and day foundation ranges', async () => {
    runtime.enabled = true;
    render(<CalendarGridSurface />);

    await waitFor(() => { expect(runtime.listOccurrences).toHaveBeenCalledTimes(1); });
    fireEvent.click(screen.getByTestId('calendar-grid-view-week'));
    await waitFor(() => { expect(runtime.listOccurrences).toHaveBeenCalledTimes(2); });
    fireEvent.click(screen.getByTestId('calendar-grid-view-day'));
    await waitFor(() => { expect(runtime.listOccurrences).toHaveBeenCalledTimes(3); });

    for (const [range] of runtime.listOccurrences.mock.calls) {
      expect(Date.parse(range.endUtc)).toBeGreaterThan(Date.parse(range.startUtc));
      expect(Date.parse(range.endUtc) - Date.parse(range.startUtc)).toBeLessThanOrEqual(31 * 24 * 60 * 60 * 1000);
    }
  });

  it('creates UTC-bounded month, week, and day ranges without duplicating recurrence rules', () => {
    const now = new Date('2026-08-05T15:00:00Z');
    expect(calendarGridRange('month', now)).toEqual({ startUtc: '2026-08-01T00:00:00.000Z', endUtc: '2026-09-01T00:00:00.000Z' });
    expect(calendarGridRange('week', now)).toEqual({ startUtc: '2026-08-03T00:00:00.000Z', endUtc: '2026-08-10T00:00:00.000Z' });
    expect(calendarGridRange('day', now)).toEqual({ startUtc: '2026-08-05T00:00:00.000Z', endUtc: '2026-08-06T00:00:00.000Z' });
  });
});
