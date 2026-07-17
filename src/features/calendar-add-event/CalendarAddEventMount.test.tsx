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

function applyPatch(record: CalendarEventRecord, patch: CalendarEventPatch): CalendarEventRecord {
  const notes = patch.notes === null ? undefined : patch.notes ?? record.notes;
  const recurrence = patch.recurrence === null ? undefined : patch.recurrence ?? record.recurrence;
  return {
    ...record, title: patch.title ?? record.title, startUtc: patch.startUtc ?? record.startUtc,
    endUtc: patch.endUtc ?? record.endUtc, displayTimezone: patch.displayTimezone ?? record.displayTimezone,
    allDay: patch.allDay ?? record.allDay, ...(notes === undefined ? {} : { notes }),
    ...(recurrence === undefined ? {} : { recurrence }),
  };
}

function stores(events: readonly CalendarEventRecord[] = []) {
  const create = vi.fn((draft: CalendarEventDraft) => Promise.resolve(event({ id: 'created-event', ...draft })));
  const update = vi.fn((id: string, patch: CalendarEventPatch) => {
    const existing = events.find((candidate) => candidate.id === id) ?? event({ id });
    return Promise.resolve(applyPatch(existing, patch));
  });
  const cancel = vi.fn();
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
  it('renders the new-event sheet over an inactive source, with canonical first-view actions', () => {
    mocks.enabled = true;
    render(<CalendarAddEventMount />);

    expect(screen.getByRole('dialog', { name: 'New event' })).toBeInTheDocument();
    expect(screen.getByTestId('calendar-add-event-source')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByTestId('calendar-add-event-title')).toHaveAttribute('placeholder', 'Event title');
    expect(screen.getByTestId('calendar-add-event-status')).toHaveTextContent('Saved locally');
    expect(screen.getByTestId('calendar-add-event-cancel')).toHaveTextContent('Cancel');
    expect(screen.getByTestId('calendar-add-event-save')).toHaveTextContent('Save event');
  });

  it('creates supported recurring events, closes only after save, and gives a concrete confirmation', async () => {
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
    await waitFor(() => { expect(screen.queryByTestId('calendar-add-event-sheet')).not.toBeInTheDocument(); });
    expect(screen.getByTestId('calendar-add-event-saved')).toHaveTextContent('Event saved.');
  });

  it('uses the event title and linked record in edit mode, preserving the thin public patch', async () => {
    mocks.enabled = true;
    const selected = event({ contextRef: { kind: 'household', id: 'household-1', label: 'Morgan Family' } });
    const { update } = stores([selected]);
    render(<CalendarAddEventMount />);

    fireEvent.click(screen.getByTestId('calendar-add-event-cancel'));
    fireEvent.click(screen.getByTestId('calendar-add-event-edit-event-1'));
    expect(screen.getByRole('dialog', { name: 'Annual review' })).toBeInTheDocument();
    expect(screen.getByTestId('calendar-add-event-linked-record')).toHaveTextContent('Morgan Family');
    fireEvent.change(screen.getByTestId('calendar-add-event-title'), { target: { value: 'Updated review' } });
    fireEvent.click(screen.getByTestId('calendar-add-event-save'));

    await waitFor(() => { expect(update).toHaveBeenCalledOnce(); });
    expect(update).toHaveBeenCalledWith('event-1', expect.objectContaining({ title: 'Updated review' }));
    expect(update.mock.calls[0]?.[1]).not.toHaveProperty('calendarId');
  });

  it('uses a calm direct End error, preserves values, and returns focus to End', async () => {
    mocks.enabled = true;
    const { create } = stores();
    render(<CalendarAddEventMount />);

    fireEvent.change(screen.getByTestId('calendar-add-event-title'), { target: { value: 'Time check' } });
    fireEvent.change(screen.getByTestId('calendar-add-event-start'), { target: { value: '2026-08-03T15:00' } });
    fireEvent.change(screen.getByTestId('calendar-add-event-end'), { target: { value: '2026-08-03T14:00' } });
    fireEvent.click(screen.getByTestId('calendar-add-event-save'));

    await waitFor(() => { expect(screen.getByTestId('calendar-add-event-end-error')).toHaveTextContent('End time needs to be after start time.'); });
    expect(screen.getByTestId('calendar-add-event-end')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByTestId('calendar-add-event-end')).toHaveFocus();
    expect(create).not.toHaveBeenCalled();
  });

  it('keeps the stable sheet and entered values open when saving fails', async () => {
    mocks.enabled = true;
    const { create } = stores();
    create.mockRejectedValueOnce(new Error('Calendar is unavailable. Try again.'));
    render(<CalendarAddEventMount />);

    fireEvent.change(screen.getByTestId('calendar-add-event-title'), { target: { value: 'Retry review' } });
    fireEvent.click(screen.getByTestId('calendar-add-event-save'));

    await waitFor(() => { expect(screen.getByTestId('calendar-add-event-error')).toHaveTextContent('Calendar is unavailable. Try again.'); });
    expect(screen.getByTestId('calendar-add-event-sheet')).toBeInTheDocument();
    expect(screen.getByTestId('calendar-add-event-title')).toHaveValue('Retry review');
  });
});
