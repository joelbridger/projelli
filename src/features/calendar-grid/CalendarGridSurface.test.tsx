import '@/i18n';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type {
  CalendarEventRecord,
  CalendarEventStore,
  CalendarOccurrence,
  CalendarRange,
} from '@/features/calendar';
import type { SchedulingSurfaceRuntime } from '@/platform/calendar';

const runtime = vi.hoisted(() => ({
  enabled: false,
  events: [] as readonly CalendarEventRecord[],
  listOccurrences: vi.fn<(range: CalendarRange) => Promise<readonly CalendarOccurrence[]>>(),
  useCalendarEventStore: vi.fn(),
  calendarStore: null as unknown as Pick<CalendarEventStore, 'events' | 'error' | 'listOccurrences'>,
}));

vi.mock('@/platform/flags', () => ({ useFlag: () => runtime.enabled }));
vi.mock('@/platform/flags/router', () => ({ isEnabled: () => runtime.enabled }));
vi.mock('@/features/calendar', () => ({ useCalendarEventStore: runtime.useCalendarEventStore }));

import {
  CalendarGridSurface,
  calendarGridRange,
  calendarGridSchedulingSurface,
  createCalendarGridViewComposition,
  defineCalendarGridView,
} from '@/features/calendar-grid';

declare module '@/features/calendar-grid' {
  interface CalendarGridViewMap {
    'outside-agenda': true;
  }
}

const ANCHOR = new Date('2026-08-05T15:00:00Z');

const occurrence = (overrides: Partial<CalendarOccurrence> = {}): CalendarOccurrence => ({
  occurrenceKey: 'event-1@2026-08-05T09:00:00Z',
  sourceEventId: 'event-1',
  kind: 'calendar_event',
  title: 'Planning call',
  startUtc: '2026-08-05T09:00:00Z',
  endUtc: '2026-08-05T09:30:00Z',
  displayTimezone: 'UTC',
  allDay: false,
  calendarId: 'calendar:local',
  status: 'scheduled',
  ...overrides,
});

const eventRecord = (overrides: Partial<CalendarEventRecord> = {}): CalendarEventRecord => ({
  id: 'event-1',
  kind: 'calendar_event',
  title: 'Planning call',
  startUtc: '2026-08-05T09:00:00Z',
  endUtc: '2026-08-05T09:30:00Z',
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
    runtime.events = [];
    runtime.listOccurrences.mockReset();
    runtime.listOccurrences.mockResolvedValue([]);
    runtime.useCalendarEventStore.mockReset();
    runtime.calendarStore = {
      events: runtime.events,
      error: null,
      listOccurrences: runtime.listOccurrences,
    };
    runtime.useCalendarEventStore.mockImplementation(() => runtime.calendarStore);
  });

  it('stays fully inert while dark, without a calendar hook, query, descriptor registration, or layout', () => {
    render(<CalendarGridSurface />);

    expect(screen.queryByTestId('calendar-grid')).toBeNull();
    expect(runtime.useCalendarEventStore).not.toHaveBeenCalled();
    expect(runtime.listOccurrences).not.toHaveBeenCalled();
    expect(calendarGridSchedulingSurface.isEnabled?.()).toBe(false);
    expect(calendarGridSchedulingSurface.mount(schedulingRuntime)).not.toBeNull();
  });

  it('renders a genuine month cell grid with chronological stable-key occurrences', async () => {
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

    render(<CalendarGridSurface now={ANCHOR} />);

    const month = await screen.findByTestId('calendar-grid-month');
    expect(within(month).getAllByTestId('calendar-grid-month-day')).toHaveLength(31);
    const augustFifth = within(month).getAllByTestId('calendar-grid-month-day')
      .find((cell) => cell.getAttribute('data-calendar-day') === '2026-08-05');
    if (!augustFifth) throw new Error('Expected the August 5 month cell.');
    const buttons = within(augustFifth).getAllByRole('button');
    expect(buttons.map((button) => button.getAttribute('data-occurrence-key'))).toEqual([
      oneTime.occurrenceKey,
      recurring.occurrenceKey,
    ]);
    expect(runtime.listOccurrences).toHaveBeenCalledTimes(1);
  });

  it('renders seven week columns with hourly lanes and places occurrences in the matching lane', async () => {
    runtime.enabled = true;
    const scheduled = occurrence();
    runtime.listOccurrences.mockResolvedValue([scheduled]);
    render(<CalendarGridSurface now={ANCHOR} />);
    await screen.findByTestId('calendar-grid-month');

    fireEvent.click(screen.getByTestId('calendar-grid-view-week'));

    const week = await screen.findByTestId('calendar-grid-week');
    expect(within(week).getAllByTestId('calendar-grid-week-day-heading')).toHaveLength(7);
    expect(within(week).getAllByTestId('calendar-grid-week-time-lane')).toHaveLength(7 * 24);
    const lane = within(week).getAllByTestId('calendar-grid-week-time-lane').find((candidate) =>
      candidate.getAttribute('data-calendar-day') === '2026-08-05'
      && candidate.getAttribute('data-calendar-hour') === '9');
    if (!lane) throw new Error('Expected the Wednesday 9 AM week lane.');
    expect(within(lane).getByTestId(`calendar-occurrence-${scheduled.occurrenceKey}`)).toBeTruthy();
  });

  it('renders a distinct 24-hour day timeline and places the occurrence at its start hour', async () => {
    runtime.enabled = true;
    const scheduled = occurrence();
    runtime.listOccurrences.mockResolvedValue([scheduled]);
    render(<CalendarGridSurface now={ANCHOR} />);
    await screen.findByTestId('calendar-grid-month');

    fireEvent.click(screen.getByTestId('calendar-grid-view-day'));

    const day = await screen.findByTestId('calendar-grid-day');
    expect(within(day).getAllByTestId('calendar-grid-day-hour')).toHaveLength(24);
    const nineAm = within(day).getAllByTestId('calendar-grid-day-hour')
      .find((row) => row.getAttribute('data-calendar-hour') === '9');
    if (!nineAm) throw new Error('Expected the 9 AM day timeline row.');
    expect(within(nineAm).getByTestId(`calendar-occurrence-${scheduled.occurrenceKey}`)).toBeTruthy();
  });

  it('lets a third-party public view become selectable and receive the exact bounded projection', async () => {
    runtime.enabled = true;
    const scheduled = occurrence();
    runtime.listOccurrences.mockResolvedValue([scheduled]);
    const received: Array<{ range: CalendarRange; occurrences: readonly CalendarOccurrence[] }> = [];
    const outsideView = defineCalendarGridView({
      id: 'outside-agenda',
      order: 40,
      labelKey: 'calendar-grid.views.month',
      mount: (context) => {
        received.push({ range: context.range, occurrences: context.occurrences });
        return <div data-testid="outside-agenda-view">
          {context.occurrences.map((item) => <button
            key={item.occurrenceKey}
            type="button"
            onClick={() => { context.onSelectOccurrence(item.occurrenceKey); }}
          >{item.title}</button>)}
        </div>;
      },
    });
    expect(() => createCalendarGridViewComposition(outsideView, outsideView)).toThrow('duplicate view id');

    render(<CalendarGridSurface
      now={ANCHOR}
      viewComposition={createCalendarGridViewComposition(outsideView)}
    />);
    await screen.findByTestId(`calendar-occurrence-${scheduled.occurrenceKey}`);
    fireEvent.click(screen.getByTestId('calendar-grid-view-outside-agenda'));

    const outside = await screen.findByTestId('outside-agenda-view');
    expect(received.at(-1)?.range).toEqual(calendarGridRange('month', ANCHOR));
    expect(received.at(-1)?.occurrences[0]).toBe(scheduled);
    fireEvent.click(within(outside).getByRole('button', { name: scheduled.title }));
    expect(screen.getByTestId('calendar-grid-selection').textContent).toContain(scheduled.title);
  });

  it('uses the same read-only occurrence for the selected rail, including a cancelled event', async () => {
    runtime.enabled = true;
    const scheduled = occurrence();
    const cancelled = occurrence({
      occurrenceKey: 'event-2@2026-08-05T11:00:00Z',
      sourceEventId: 'event-2',
      title: 'Cancelled review',
      startUtc: '2026-08-05T11:00:00Z',
      endUtc: '2026-08-05T11:30:00Z',
      status: 'cancelled',
    });
    runtime.listOccurrences.mockResolvedValue([scheduled, cancelled]);

    render(<CalendarGridSurface now={ANCHOR} />);

    await screen.findByTestId(`calendar-occurrence-${scheduled.occurrenceKey}`);
    fireEvent.click(screen.getByTestId(`calendar-occurrence-${cancelled.occurrenceKey}`));
    expect(screen.getByTestId('calendar-grid-selection').textContent).toContain('Cancelled review');
    expect(screen.getByTestId('calendar-grid-selection').textContent).toContain('calendar:local');
    expect(screen.getByTestId('calendar-grid-selection-status').textContent).toContain('Cancelled');
    expect(runtime.listOccurrences).toHaveBeenCalledTimes(1);
  });

  it('refreshes both the mounted layout and rail after title and timing edits', async () => {
    runtime.enabled = true;
    const initial = occurrence();
    const edited = occurrence({
      occurrenceKey: 'event-1@2026-08-05T13:30:00Z',
      title: 'Updated planning call',
      startUtc: '2026-08-05T13:30:00Z',
      endUtc: '2026-08-05T14:00:00Z',
    });
    runtime.events = [eventRecord()];
    runtime.listOccurrences.mockResolvedValueOnce([initial]).mockResolvedValue([edited]);
    const { rerender } = render(<CalendarGridSurface now={ANCHOR} />);
    await screen.findByTestId(`calendar-occurrence-${initial.occurrenceKey}`);

    runtime.events = [eventRecord({
      title: edited.title,
      startUtc: edited.startUtc,
      endUtc: edited.endUtc,
    })];
    runtime.calendarStore = {
      ...runtime.calendarStore,
      events: runtime.events,
    };
    rerender(<CalendarGridSurface now={ANCHOR} />);

    const updatedButton = await screen.findByTestId(`calendar-occurrence-${edited.occurrenceKey}`);
    expect(updatedButton.textContent).toContain('Updated planning call');
    await waitFor(() => {
      expect(screen.getByTestId('calendar-grid-selection').textContent).toContain('Updated planning call');
      expect(screen.getByTestId('calendar-grid-selection').textContent).toContain('1:30');
    });
    expect(runtime.listOccurrences).toHaveBeenCalledTimes(2);
  });

  it('moves only among finite month, week, and day foundation ranges', async () => {
    runtime.enabled = true;
    render(<CalendarGridSurface now={ANCHOR} />);

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
    expect(calendarGridRange('month', ANCHOR)).toEqual({ startUtc: '2026-08-01T00:00:00.000Z', endUtc: '2026-09-01T00:00:00.000Z' });
    expect(calendarGridRange('week', ANCHOR)).toEqual({ startUtc: '2026-08-03T00:00:00.000Z', endUtc: '2026-08-10T00:00:00.000Z' });
    expect(calendarGridRange('day', ANCHOR)).toEqual({ startUtc: '2026-08-05T00:00:00.000Z', endUtc: '2026-08-06T00:00:00.000Z' });
  });
});
