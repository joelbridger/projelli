import '@/i18n';
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  BookingAvailabilityDraft,
  BookingAvailabilityRecord,
  CalendarCapabilityDraft,
  CalendarCapabilityState,
  CalendarOccurrence,
  CalendarRange,
  CalendarSettingsDraft,
  CalendarSettingsState,
  getBookableSlots,
  getBusyBlocks,
} from '@/features/calendar';
import { BookingAvailabilitySettingsMount } from './BookingAvailabilitySettings';

const testState = vi.hoisted(() => ({
  enabled: false,
  useFlag: vi.fn<(id: string) => boolean>(),
  useCalendarCapabilityStore: vi.fn(),
  useBookingAvailabilityStore: vi.fn(),
  useCalendarSettingsStore: vi.fn(),
  useCalendarEventStore: vi.fn(),
  saveCapability:
    vi.fn<
      (draft: CalendarCapabilityDraft) => Promise<CalendarCapabilityState>
    >(),
  saveAvailability:
    vi.fn<
      (draft: BookingAvailabilityDraft) => Promise<BookingAvailabilityRecord>
    >(),
  saveSettings:
    vi.fn<(draft: CalendarSettingsDraft) => Promise<CalendarSettingsState>>(),
  listOccurrences:
    vi.fn<(range: CalendarRange) => Promise<readonly CalendarOccurrence[]>>(),
  getBusyBlocks: vi.fn<typeof getBusyBlocks>(),
  getBookableSlots: vi.fn<typeof getBookableSlots>(),
}));

vi.mock('@/platform/flags', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/platform/flags')>()),
  useFlag: testState.useFlag,
}));

vi.mock('@/features/calendar', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/calendar')>()),
  useCalendarCapabilityStore: testState.useCalendarCapabilityStore,
  useBookingAvailabilityStore: testState.useBookingAvailabilityStore,
  useCalendarSettingsStore: testState.useCalendarSettingsStore,
  useCalendarEventStore: testState.useCalendarEventStore,
  getBusyBlocks: testState.getBusyBlocks,
  getBookableSlots: testState.getBookableSlots,
}));

function capabilityState(): CalendarCapabilityState {
  return {
    scope: 'active-workspace-advisor',
    advisorId: 'local-user',
    calendars: [
      {
        id: 'calendar:local',
        label: 'My calendar',
        ownership: 'local',
        canBlockBusyTime: true,
      },
      {
        id: 'calendar:team',
        label: 'Team calendar',
        ownership: 'local',
        canBlockBusyTime: true,
      },
    ],
    homeCalendarId: 'calendar:local',
    busyCalendarIds: ['calendar:local'],
  };
}

function availabilityRecord(): BookingAvailabilityRecord {
  return {
    id: 'booking-availability:local-user',
    kind: 'booking_availability',
    scope: 'active-workspace-advisor',
    advisorId: 'local-user',
    advisorTimezone: 'UTC',
    workingHours: {
      monday: [{ startLocal: '09:00', endLocal: '10:00' }],
      tuesday: [],
      wednesday: [],
      thursday: [],
      friday: [],
      saturday: [],
      sunday: [],
    },
    meetingTypes: [
      {
        id: 'intro',
        name: 'Intro call',
        durationMinutes: 30,
        bufferBeforeMinutes: 0,
        bufferAfterMinutes: 0,
      },
    ],
    minimumNoticeMinutes: 30,
    maximumHorizonDays: 30,
  };
}

async function waitForReadyPreview(): Promise<void> {
  await waitFor(() => {
    expect(testState.getBookableSlots).toHaveBeenCalled();
  });
}

async function expectRefusalWithoutWrites(message: RegExp): Promise<void> {
  fireEvent.click(screen.getByTestId('booking-availability-save'));
  expect(
    await screen.findByTestId('booking-availability-status')
  ).toHaveTextContent(message);
  expect(
    screen.getByTestId('booking-availability-draft-error')
  ).toHaveTextContent(message);
  expect(testState.saveCapability).not.toHaveBeenCalled();
  expect(testState.saveAvailability).not.toHaveBeenCalled();
  expect(testState.saveSettings).not.toHaveBeenCalled();
}

describe('BookingAvailabilitySettingsMount', () => {
  beforeEach(() => {
    testState.enabled = false;
    testState.useFlag.mockReset().mockImplementation(() => testState.enabled);
    testState.useCalendarCapabilityStore.mockReset().mockReturnValue({
      state: capabilityState(),
      save: testState.saveCapability,
    });
    testState.useBookingAvailabilityStore.mockReset().mockReturnValue({
      availability: availabilityRecord(),
      save: testState.saveAvailability,
    });
    testState.useCalendarSettingsStore.mockReset().mockReturnValue({
      save: testState.saveSettings,
    });
    testState.useCalendarEventStore.mockReset().mockReturnValue({
      listOccurrences: testState.listOccurrences,
    });
    testState.saveCapability.mockReset().mockResolvedValue({
      ...capabilityState(),
      calendars: [
        {
          id: 'calendar:local',
          label: 'Canonical local calendar',
          ownership: 'local',
          canBlockBusyTime: true,
        },
      ],
      homeCalendarId: 'calendar:local',
      busyCalendarIds: ['calendar:local'],
    });
    testState.saveAvailability.mockReset().mockResolvedValue({
      ...availabilityRecord(),
      advisorTimezone: 'America/Chicago',
      workingHours: {
        monday: [],
        tuesday: [],
        wednesday: [],
        thursday: [],
        friday: [],
        saturday: [],
        sunday: [],
      },
      meetingTypes: [],
      minimumNoticeMinutes: 0,
      maximumHorizonDays: 45,
    });
    testState.saveSettings.mockReset().mockResolvedValue({
      capability: {
        ...capabilityState(),
        calendars: [
          {
            id: 'calendar:local',
            label: 'Canonical local calendar',
            ownership: 'local',
            canBlockBusyTime: true,
          },
        ],
        homeCalendarId: 'calendar:local',
        busyCalendarIds: ['calendar:local'],
      },
      availability: {
        ...availabilityRecord(),
        advisorTimezone: 'America/Chicago',
        workingHours: {
          monday: [],
          tuesday: [],
          wednesday: [],
          thursday: [],
          friday: [],
          saturday: [],
          sunday: [],
        },
        meetingTypes: [],
        minimumNoticeMinutes: 0,
        maximumHorizonDays: 45,
      },
    });
    testState.listOccurrences.mockReset().mockResolvedValue([
      {
        occurrenceKey: 'private-event',
        sourceEventId: 'private-event',
        kind: 'calendar_event',
        title: 'Sensitive client matter',
        startUtc: '2026-07-20T10:00:00Z',
        endUtc: '2026-07-20T10:30:00Z',
        displayTimezone: 'UTC',
        allDay: false,
        calendarId: 'calendar:local',
        status: 'scheduled',
      },
    ]);
    testState.getBusyBlocks.mockReset().mockReturnValue([
      {
        calendarId: 'calendar:local',
        startUtc: '2026-07-20T10:00:00Z',
        endUtc: '2026-07-20T10:30:00Z',
      },
    ]);
    testState.getBookableSlots.mockReset().mockReturnValue([
      {
        id: 'intro@2026-07-20T11:00:00Z',
        meetingTypeId: 'intro',
        startUtc: '2026-07-20T11:00:00Z',
        endUtc: '2026-07-20T11:30:00Z',
        advisorTimezone: 'UTC',
      },
    ]);
  });

  it('stays completely inert while its flag is off, including zero settings reads', () => {
    render(<BookingAvailabilitySettingsMount />);

    expect(
      screen.queryByTestId('booking-availability-settings')
    ).not.toBeInTheDocument();
    expect(testState.useCalendarCapabilityStore).not.toHaveBeenCalled();
    expect(testState.useBookingAvailabilityStore).not.toHaveBeenCalled();
    expect(testState.useCalendarSettingsStore).not.toHaveBeenCalled();
    expect(testState.useCalendarEventStore).not.toHaveBeenCalled();
    expect(testState.listOccurrences).not.toHaveBeenCalled();
    expect(testState.getBusyBlocks).not.toHaveBeenCalled();
    expect(testState.getBookableSlots).not.toHaveBeenCalled();
  });

  it('uses opaque busy blocks and calculated slots without exposing event details or creating a booking', async () => {
    testState.enabled = true;
    render(<BookingAvailabilitySettingsMount />);

    await waitForReadyPreview();
    const busyOptions = testState.getBusyBlocks.mock.calls.at(-1)?.[1];
    expect(busyOptions?.localOccurrences[0]?.title).toBe(
      'Sensitive client matter'
    );
    expect(
      screen.getByTestId('booking-availability-busy-block')
    ).toHaveTextContent('Jul');
    expect(screen.getByTestId('booking-availability-slot')).toHaveTextContent(
      'Jul'
    );
    expect(
      screen.queryByText('Sensitive client matter')
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId('booking-availability-no-booking')
    ).toHaveTextContent('does not hold, confirm, or write a booking');
  });

  it('publishes no slots while busy time is still loading', () => {
    testState.enabled = true;
    testState.listOccurrences
      .mockReset()
      .mockReturnValue(new Promise<readonly CalendarOccurrence[]>(() => {}));
    render(<BookingAvailabilitySettingsMount />);

    expect(screen.getByText('Loading busy time…')).toBeInTheDocument();
    expect(
      screen.getByTestId('booking-availability-slots-unavailable')
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId('booking-availability-slot')
    ).not.toBeInTheDocument();
    expect(testState.getBusyBlocks).not.toHaveBeenCalled();
    expect(testState.getBookableSlots).not.toHaveBeenCalled();
  });

  it('fails closed when busy time cannot be loaded', async () => {
    testState.enabled = true;
    testState.listOccurrences
      .mockReset()
      .mockRejectedValue(new Error('Occurrence read failed.'));
    render(<BookingAvailabilitySettingsMount />);

    expect(
      await screen.findByTestId('booking-availability-busy-error')
    ).toHaveTextContent('No times are available');
    expect(
      screen.getByTestId('booking-availability-slots-unavailable')
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId('booking-availability-slot')
    ).not.toBeInTheDocument();
    expect(testState.getBusyBlocks).not.toHaveBeenCalled();
    expect(testState.getBookableSlots).not.toHaveBeenCalled();
  });

  it('saves the selected home and busy calendars with the canonical availability result', async () => {
    testState.enabled = true;
    render(<BookingAvailabilitySettingsMount />);
    await waitForReadyPreview();

    fireEvent.change(screen.getByTestId('booking-availability-home-calendar'), {
      target: { value: 'calendar:team' },
    });
    fireEvent.click(
      screen.getByTestId('booking-availability-busy-calendar-calendar:team')
    );
    fireEvent.change(screen.getByTestId('booking-availability-timezone'), {
      target: { value: 'America/Chicago' },
    });
    fireEvent.click(screen.getByTestId('booking-availability-save'));

    await waitFor(() => {
      expect(testState.saveSettings).toHaveBeenCalledOnce();
    });
    const savedDraft = testState.saveSettings.mock.calls[0]?.[0];
    expect(savedDraft?.capability.homeCalendarId).toBe('calendar:team');
    expect(savedDraft?.capability.busyCalendarIds).toEqual([
      'calendar:local',
      'calendar:team',
    ]);
    expect(savedDraft?.availability.advisorTimezone).toBe('America/Chicago');
    expect(testState.saveCapability).not.toHaveBeenCalled();
    expect(testState.saveAvailability).not.toHaveBeenCalled();
    expect(screen.getByTestId('booking-availability-status')).toHaveTextContent(
      'saved'
    );
  });

  it('does not fall back to either independent writer when the aggregate write fails', async () => {
    testState.enabled = true;
    testState.saveSettings.mockRejectedValue(
      new Error('Calendar settings storage failed.')
    );
    render(<BookingAvailabilitySettingsMount />);
    await waitForReadyPreview();

    fireEvent.change(screen.getByTestId('booking-availability-home-calendar'), {
      target: { value: 'calendar:team' },
    });
    fireEvent.change(screen.getByTestId('booking-availability-timezone'), {
      target: { value: 'America/Chicago' },
    });
    fireEvent.click(screen.getByTestId('booking-availability-save'));

    expect(
      await screen.findByTestId('booking-availability-status')
    ).toHaveTextContent('Calendar settings storage failed.');
    expect(testState.saveSettings).toHaveBeenCalledOnce();
    expect(testState.saveCapability).not.toHaveBeenCalled();
    expect(testState.saveAvailability).not.toHaveBeenCalled();
  });

  it('keeps an invalid timezone editable and refuses it before either write', async () => {
    testState.enabled = true;
    render(<BookingAvailabilitySettingsMount />);
    await waitForReadyPreview();

    fireEvent.change(screen.getByTestId('booking-availability-timezone'), {
      target: { value: 'Not/A-Timezone' },
    });

    await expectRefusalWithoutWrites(/display timezone is invalid/i);
  });

  it('keeps reversed hours editable and refuses them before either write', async () => {
    testState.enabled = true;
    render(<BookingAvailabilitySettingsMount />);
    await waitForReadyPreview();

    fireEvent.change(screen.getByLabelText('Monday end time'), {
      target: { value: '08:00' },
    });

    await expectRefusalWithoutWrites(/must end after they start/i);
  });

  it('keeps overlapping hours editable and refuses them before either write', async () => {
    testState.enabled = true;
    render(<BookingAvailabilitySettingsMount />);
    await waitForReadyPreview();

    fireEvent.click(
      within(screen.getByTestId('booking-availability-hours-monday')).getByRole(
        'button',
        { name: 'Add hours' }
      )
    );

    await expectRefusalWithoutWrites(/working hours must not overlap/i);
  });

  it('keeps an invalid meeting duration editable and refuses it before either write', async () => {
    testState.enabled = true;
    render(<BookingAvailabilitySettingsMount />);
    await waitForReadyPreview();

    fireEvent.change(screen.getByLabelText(/Length in minutes/), {
      target: { value: '0' },
    });

    await expectRefusalWithoutWrites(
      /meeting duration must be a whole number/i
    );
  });

  it('keeps an invalid numeric horizon editable and refuses it before either write', async () => {
    testState.enabled = true;
    render(<BookingAvailabilitySettingsMount />);
    await waitForReadyPreview();

    fireEvent.change(
      screen.getByTestId('booking-availability-maximum-horizon'),
      {
        target: { value: '0' },
      }
    );

    await expectRefusalWithoutWrites(
      /maximum booking horizon must be a whole number/i
    );
  });
});
