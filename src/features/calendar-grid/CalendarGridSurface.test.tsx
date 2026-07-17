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
  eventSheetHeading,
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
    expect(within(month).getAllByTestId('calendar-grid-month-day')).toHaveLength(42);
    const augustFifth = within(month).getAllByTestId('calendar-grid-month-day')
      .find((cell) => cell.getAttribute('data-calendar-day') === '2026-08-05');
    if (!augustFifth) throw new Error('Expected the August 5 month cell.');
    const buttons = within(augustFifth).getAllByRole('button');
    expect(buttons.filter((button) => button.hasAttribute('data-occurrence-key')).map((button) => button.getAttribute('data-occurrence-key'))).toEqual([
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
    expect(within(week).getAllByTestId('calendar-grid-week-time-lane').some((candidate) => candidate.getAttribute('data-calendar-day') === '2026-08-05' && candidate.getAttribute('data-calendar-hour') === '9')).toBe(true);
    expect(within(week).getByTestId(`calendar-occurrence-${scheduled.occurrenceKey}`).style.top).toBe('504px');
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
    expect(within(day).getAllByTestId('calendar-grid-day-hour').some((row) => row.getAttribute('data-calendar-hour') === '9')).toBe(true);
    expect(within(day).getByTestId(`calendar-occurrence-${scheduled.occurrenceKey}`).style.top).toBe('504px');
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
    expect(screen.getByTestId('calendar-grid-peek').textContent).toContain(scheduled.title);
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
    expect(screen.getByTestId('calendar-grid-peek').textContent).toContain('Cancelled review');
    expect(screen.getByTestId('calendar-grid-selection').textContent).toContain('calendar:local');
    expect(screen.getByTestId('calendar-grid-selection-status').textContent).toContain('Cancelled');
    expect(runtime.listOccurrences).toHaveBeenCalledTimes(1);
  });

  it('uses the shared sheet for New event and edit, with calm title fallbacks and truthful local status', async () => {
    runtime.enabled = true;
    const longTitle = 'A long calendar title that needs a calm heading fallback while the original saved event title stays untouched for the advisor';
    const scheduled = occurrence({ title: longTitle });
    runtime.listOccurrences.mockResolvedValue([scheduled]);
    render(<CalendarGridSurface now={ANCHOR} />);

    await screen.findByTestId(`calendar-occurrence-${scheduled.occurrenceKey}`);
    expect(screen.getByTestId('calendar-grid-range').textContent).toContain('August');
    expect(screen.getByTestId('calendar-grid-range').textContent).not.toContain('T00:00:00');

    fireEvent.click(screen.getByTestId('calendar-grid-new-event'));
    expect(await screen.findByTestId('calendar-event-sheet-heading')).toHaveTextContent('New event');
    expect(screen.getByTestId('calendar-event-status')).toHaveTextContent('Saved in this workspace');
    expect(screen.getByRole('button', { name: 'Save event' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    fireEvent.click(screen.getByTestId(`calendar-occurrence-${scheduled.occurrenceKey}`));
    fireEvent.click(screen.getByTestId('calendar-grid-edit-event'));
    expect(await screen.findByTestId('calendar-event-sheet-heading')).toHaveTextContent(eventSheetHeading(longTitle, 'Untitled event'));
    expect(screen.getByTestId('calendar-event-title')).toHaveValue(longTitle);
    expect(eventSheetHeading('', 'Untitled event')).toBe('Untitled event');
  });

  it('keeps the calendar frame during a real pending read instead of calling it empty', async () => {
    runtime.enabled = true;
    let resolveOccurrences: ((value: readonly CalendarOccurrence[]) => void) | undefined;
    runtime.listOccurrences.mockImplementation(() => new Promise((resolve) => { resolveOccurrences = resolve; }));
    render(<CalendarGridSurface now={ANCHOR} />);

    expect(await screen.findByTestId('calendar-grid-loading')).toBeTruthy();
    expect(screen.queryByTestId('calendar-grid-empty')).toBeNull();
    resolveOccurrences?.([]);
    await screen.findByTestId('calendar-grid-empty');
  });

  it('places overlapping week events side-by-side at their real start time and duration', async () => {
    runtime.enabled = true;
    const first = occurrence({ occurrenceKey: 'event-1@2026-08-05T14:00:00Z', startUtc: '2026-08-05T14:00:00Z', endUtc: '2026-08-05T16:00:00Z' });
    const second = occurrence({ occurrenceKey: 'event-2@2026-08-05T14:00:00Z', sourceEventId: 'event-2', title: 'Overlapping review', startUtc: '2026-08-05T14:00:00Z', endUtc: '2026-08-05T15:00:00Z' });
    runtime.listOccurrences.mockResolvedValue([first, second]);
    render(<CalendarGridSurface now={ANCHOR} />);
    await screen.findByTestId('calendar-grid-month');
    fireEvent.click(screen.getByTestId('calendar-grid-view-week'));
    const firstButton = await screen.findByTestId(`calendar-occurrence-${first.occurrenceKey}`);
    const secondButton = screen.getByTestId(`calendar-occurrence-${second.occurrenceKey}`);
    expect(firstButton.style.top).toBe('784px');
    expect(firstButton.style.height).toBe('112px');
    expect(firstButton.style.left).not.toBe(secondButton.style.left);
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
    fireEvent.click(screen.getByTestId(`calendar-occurrence-${initial.occurrenceKey}`));

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
    expect(screen.queryByTestId('calendar-grid-peek')).toBeNull();
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
