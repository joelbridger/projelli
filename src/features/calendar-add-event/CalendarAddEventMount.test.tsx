import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  CalendarCapabilityStore,
  CalendarEventDraft,
  CalendarEventPatch,
  CalendarEventRecord,
  CalendarEventStore,
} from '@/features/calendar';

const mocks = vi.hoisted(() => ({
  enabled: false,
  eventStore: null as CalendarEventStore | null,
  capabilityStore: null as CalendarCapabilityStore | null,
  useCalendarEventStore: vi.fn<() => CalendarEventStore>(),
  useCalendarCapabilityStore: vi.fn<() => CalendarCapabilityStore>(),
}));

vi.mock('@/platform/flags', () => ({
  isEnabled: () => mocks.enabled,
  useFlag: () => mocks.enabled,
}));
vi.mock('@/features/calendar', () => ({
  CalendarFoundationError: class CalendarFoundationError extends Error {
    code: string;
    constructor(code: string, message: string) { super(message); this.code = code; }
  },
  useCalendarEventStore: () => mocks.useCalendarEventStore(),
  useCalendarCapabilityStore: () => mocks.useCalendarCapabilityStore(),
  validateCalendarEventDraft: <T,>(value: T) => value,
  validateCalendarRecurrence: <T extends { frequency: string; byWeekday?: readonly string[] }>(value: T) => {
    if (value.frequency === 'weekly' && value.byWeekday === undefined) {
      throw new Error('Weekday selectors are supported only for weekly recurrence.');
    }
    return value;
  },
}));

import { CalendarAddEventMount } from './CalendarAddEventMount';

function event(overrides: Partial<CalendarEventRecord> = {}): CalendarEventRecord {
  return {
    id: 'event-1', kind: 'calendar_event', title: 'Annual review', notes: 'Bring statements',
    startUtc: '2026-08-03T14:00:00Z', endUtc: '2026-08-03T14:30:00Z',
    displayTimezone: 'America/New_York', allDay: false, calendarId: 'calendar:local', status: 'scheduled',
    ...overrides,
  };
}

function applyPatch(
  record: CalendarEventRecord,
  patch: CalendarEventPatch,
): CalendarEventRecord {
  const notes = patch.notes === null ? undefined : patch.notes ?? record.notes;
  const contextRef = patch.contextRef === null
    ? undefined
    : patch.contextRef ?? record.contextRef;
  const recurrence = patch.recurrence === null
    ? undefined
    : patch.recurrence ?? record.recurrence;

  return {
    id: record.id,
    kind: record.kind,
    title: patch.title ?? record.title,
    startUtc: patch.startUtc ?? record.startUtc,
    endUtc: patch.endUtc ?? record.endUtc,
    displayTimezone: patch.displayTimezone ?? record.displayTimezone,
    allDay: patch.allDay ?? record.allDay,
    calendarId: record.calendarId,
    status: record.status,
    ...(notes === undefined ? {} : { notes }),
    ...(contextRef === undefined ? {} : { contextRef }),
    ...(record.seriesId === undefined ? {} : { seriesId: record.seriesId }),
    ...(recurrence === undefined ? {} : { recurrence }),
  };
}

function stores(events: readonly CalendarEventRecord[] = []) {
  const create = vi.fn((draft: CalendarEventDraft) => Promise.resolve(event({ id: 'created-event', ...draft })));
  const update = vi.fn((id: string, patch: CalendarEventPatch) => {
    const existing = events.find((candidate) => candidate.id === id) ?? event({ id });
    return Promise.resolve(applyPatch(existing, patch));
  });
  const cancel = vi.fn((id: string) => Promise.resolve(event({ id, status: 'cancelled' })));
  mocks.eventStore = { events, error: null, create, update, cancel, get: vi.fn(), listOccurrences: vi.fn() };
  mocks.capabilityStore = {
    state: {
      scope: 'active-workspace-advisor', advisorId: 'local-user', homeCalendarId: 'calendar:local', busyCalendarIds: ['calendar:local'],
      calendars: [
        { id: 'calendar:local', label: 'My calendar', ownership: 'local', canBlockBusyTime: true },
        { id: 'calendar:external', label: 'Read-only calendar', ownership: 'external-read-only', canBlockBusyTime: true },
      ],
    },
    error: null, get: vi.fn(), save: vi.fn(), setSelection: vi.fn(),
  };
  mocks.useCalendarEventStore.mockImplementation(() => mocks.eventStore as CalendarEventStore);
  mocks.useCalendarCapabilityStore.mockImplementation(() => mocks.capabilityStore as CalendarCapabilityStore);
  return { create, update, cancel };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.enabled = false;
  stores();
});

afterEach(() => { mocks.enabled = false; });

describe('CalendarAddEventMount', () => {
  it('creates supported recurring events through the public event store', async () => {
    mocks.enabled = true;
    const { create } = stores();
    render(<CalendarAddEventMount />);

    fireEvent.change(screen.getByTestId('calendar-add-event-title'), { target: { value: 'Weekly review' } });
    fireEvent.change(screen.getByTestId('calendar-add-event-frequency'), { target: { value: 'weekly' } });
    fireEvent.click(screen.getByLabelText('Mon'));
    fireEvent.click(screen.getByTestId('calendar-add-event-save'));

    await waitFor(() => { expect(create).toHaveBeenCalledOnce(); });
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Weekly review', calendarId: 'calendar:local', recurrence: { frequency: 'weekly', interval: 1, byWeekday: ['monday'] },
    }));
    expect(screen.getByTestId('calendar-add-event-saved')).toHaveTextContent('created-event');
  });

  it('uses thin public updates and a status cancel for an existing event', async () => {
    mocks.enabled = true;
    const { update, cancel } = stores([event()]);
    render(<CalendarAddEventMount />);

    fireEvent.click(screen.getByTestId('calendar-add-event-edit-event-1'));
    fireEvent.change(screen.getByTestId('calendar-add-event-title'), { target: { value: 'Updated review' } });
    fireEvent.click(screen.getByTestId('calendar-add-event-save'));
    await waitFor(() => { expect(update).toHaveBeenCalledOnce(); });
    expect(update).toHaveBeenCalledWith('event-1', expect.objectContaining({ title: 'Updated review' }));
    expect(update.mock.calls[0]?.[1]).not.toHaveProperty('calendarId');

    fireEvent.click(screen.getByTestId('calendar-add-event-cancel'));
    await waitFor(() => { expect(cancel).toHaveBeenCalledWith('event-1'); });
  });

  it('shows an honest refusal and does not write an invalid recurrence', async () => {
    mocks.enabled = true;
    const { create } = stores();
    render(<CalendarAddEventMount />);

    fireEvent.change(screen.getByTestId('calendar-add-event-title'), { target: { value: 'Bad weekly review' } });
    fireEvent.change(screen.getByTestId('calendar-add-event-frequency'), { target: { value: 'weekly' } });
    fireEvent.click(screen.getByTestId('calendar-add-event-save'));

    await waitFor(() => { expect(screen.getByTestId('calendar-add-event-error')).toHaveTextContent('Weekday selectors are supported only for weekly recurrence.'); });
    expect(create).not.toHaveBeenCalled();
  });
});
