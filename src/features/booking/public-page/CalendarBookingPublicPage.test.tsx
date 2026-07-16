import '@/i18n';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BookingAvailabilityRecord, CalendarCapabilityState, CalendarOccurrence } from '@/features/calendar';
import { defaultBookingPageBranding } from './types';
import {
  CalendarBookingPublicPage,
  FlaggedCalendarBookingPublicPage,
} from './CalendarBookingPublicPage';
import { toCalendarBookingPageAvailabilityConsumer } from './calendarBookingAvailability';

const calendar = vi.hoisted(() => ({
  availabilityStore: vi.fn(),
  capabilityStore: vi.fn(),
  eventStore: vi.fn(),
}));
const useFlagMock = vi.hoisted(() => vi.fn<() => boolean>());

vi.mock('@/features/calendar', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/calendar')>()),
  useBookingAvailabilityStore: calendar.availabilityStore,
  useCalendarCapabilityStore: calendar.capabilityStore,
  useCalendarEventStore: calendar.eventStore,
}));
vi.mock('@/platform/flags', () => ({ useFlag: useFlagMock }));

const range = { startUtc: '2026-07-20T00:00:00Z', endUtc: '2026-07-21T00:00:00Z' };
const capability: CalendarCapabilityState = {
  advisorId: 'local-user',
  busyCalendarIds: ['calendar:local'],
  calendars: [{ id: 'calendar:local', label: 'My calendar', ownership: 'local', canBlockBusyTime: true }],
  homeCalendarId: 'calendar:local',
  scope: 'active-workspace-advisor',
};
const availability: BookingAvailabilityRecord = {
  advisorId: 'local-user',
  advisorTimezone: 'UTC',
  id: 'booking-availability:local-user',
  kind: 'booking_availability',
  maximumHorizonDays: 14,
  meetingTypes: [{ id: 'intro', name: 'Private name', durationMinutes: 30, bufferBeforeMinutes: 0, bufferAfterMinutes: 0 }],
  minimumNoticeMinutes: 0,
  scope: 'active-workspace-advisor',
  workingHours: {
    monday: [{ startLocal: '09:00', endLocal: '10:00' }],
    tuesday: [], wednesday: [], thursday: [], friday: [], saturday: [], sunday: [],
  },
};

function installStores(overrides: {
  availability?: Promise<BookingAvailabilityRecord>;
  capability?: Promise<CalendarCapabilityState>;
  occurrences?: Promise<readonly CalendarOccurrence[]>;
} = {}) {
  calendar.capabilityStore.mockReturnValue({ get: () => overrides.capability ?? Promise.resolve(capability) });
  calendar.availabilityStore.mockReturnValue({ get: () => overrides.availability ?? Promise.resolve(availability) });
  calendar.eventStore.mockReturnValue({ listOccurrences: () => overrides.occurrences ?? Promise.resolve([]) });
}

beforeEach(() => {
  vi.clearAllMocks();
  useFlagMock.mockReturnValue(true);
  installStores();
});

describe('CalendarBookingPublicPage', () => {
  it('keeps the dark path inert before any calendar hook, adapter input, or public page load', () => {
    useFlagMock.mockReturnValue(false);
    render(<FlaggedCalendarBookingPublicPage branding={defaultBookingPageBranding} nowUtc="2026-07-19T00:00:00Z" range={range} />);

    expect(useFlagMock).toHaveBeenCalledWith('booking-public-calendar');
    expect(calendar.eventStore).not.toHaveBeenCalled();
    expect(calendar.capabilityStore).not.toHaveBeenCalled();
    expect(calendar.availabilityStore).not.toHaveBeenCalled();
    expect(screen.queryByTestId('booking-public-page')).not.toBeInTheDocument();
  });

  it('renders the injected loading, unavailable, and display-ready states without changing the public page', async () => {
    let resolveCapability!: (value: CalendarCapabilityState) => void;
    installStores({
      capability: new Promise((resolve) => {
        resolveCapability = resolve;
      }),
    });
    const { rerender } = render(<FlaggedCalendarBookingPublicPage branding={defaultBookingPageBranding} nowUtc="2026-07-19T00:00:00Z" range={range} />);
    expect(screen.getByTestId('booking-public-page-loading')).toBeInTheDocument();

    resolveCapability(capability);
    await waitFor(() => {
      expect(screen.getByTestId('booking-public-page-slot-intro@2026-07-20T09:00:00Z')).toBeInTheDocument();
    });
    expect(screen.getByTestId('booking-public-page-brand-header')).toHaveTextContent('Northstar Advisory');

    installStores({
      availability: Promise.resolve({ ...availability, workingHours: { ...availability.workingHours, monday: [] } }),
    });
    rerender(<CalendarBookingPublicPage branding={defaultBookingPageBranding} nowUtc="2026-07-19T00:00:00Z" range={{ ...range, endUtc: '2026-07-22T00:00:00Z' }} />);
    await waitFor(() => {
      expect(screen.getByTestId('booking-public-page-unavailable')).toBeInTheDocument();
    });
  });

  it('uses the adapter as a privacy-only seam and slot selection makes no booking claim or call', async () => {
    const occurrence: CalendarOccurrence = {
      allDay: false,
      calendarId: 'calendar:local',
      displayTimezone: 'UTC',
      endUtc: '2026-07-20T08:30:00Z',
      kind: 'calendar_event',
      occurrenceKey: 'secret@2026-07-20T08:00:00Z',
      sourceEventId: 'secret-event',
      startUtc: '2026-07-20T08:00:00Z',
      status: 'scheduled',
      title: 'Very private client title',
    };
    const consumer = toCalendarBookingPageAvailabilityConsumer({
      availability,
      capability,
      occurrences: [occurrence],
      nowUtc: '2026-07-19T00:00:00Z',
      range,
    });
    expect(Object.keys(consumer)).toEqual(['getPresentation']);
    expect(JSON.stringify(consumer.getPresentation())).not.toContain('Very private client title');
    expect(JSON.stringify(consumer.getPresentation())).not.toContain('secret-event');
    expect(JSON.stringify(consumer.getPresentation())).not.toContain('meetingTypes');

    render(<CalendarBookingPublicPage branding={defaultBookingPageBranding} nowUtc="2026-07-19T00:00:00Z" range={range} />);
    await waitFor(() => {
      expect(screen.getByTestId('booking-public-page-slot-intro@2026-07-20T09:00:00Z')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('booking-public-page-slot-intro@2026-07-20T09:00:00Z'));
    expect(screen.getByTestId('booking-public-page-confirmation-safety')).toHaveTextContent('No time is held');
  });

  it('shows the existing safe unavailable state when the read cannot be completed', async () => {
    installStores({ capability: Promise.reject(new Error('calendar unavailable')) });
    render(<CalendarBookingPublicPage branding={defaultBookingPageBranding} nowUtc="2026-07-19T00:00:00Z" range={range} />);

    await waitFor(() => {
      expect(screen.getByTestId('booking-public-page-unavailable')).toBeInTheDocument();
    });
    expect(screen.queryByTestId(/booking-public-page-slot-/)).not.toBeInTheDocument();
  });
});
