import { describe, expect, it } from 'vitest';
import { getBookableSlots, getBusyBlocks } from './availability';
import { defaultCalendarCapabilityState, validateBookingAvailabilityDraft } from './settingsStores';
import type { BookingAvailabilityRecord, CalendarWorkingHours } from './types';

function hours(monday: readonly { startLocal: string; endLocal: string }[]): CalendarWorkingHours {
  return { monday, tuesday: [], wednesday: [], thursday: [], friday: [], saturday: [], sunday: [] };
}

const availability: BookingAvailabilityRecord = {
  id: 'booking-availability:local-user',
  kind: 'booking_availability',
  scope: 'active-workspace-advisor',
  advisorId: 'local-user',
  advisorTimezone: 'UTC',
  workingHours: hours([{ startLocal: '09:00', endLocal: '11:00' }]),
  meetingTypes: [{ id: 'intro', name: 'Intro', durationMinutes: 30, bufferBeforeMinutes: 15, bufferAfterMinutes: 15 }],
  minimumNoticeMinutes: 60,
  maximumHorizonDays: 14,
};
const introMeeting = { id: 'intro', name: 'Intro', durationMinutes: 30, bufferBeforeMinutes: 15, bufferAfterMinutes: 15 } as const;

describe('calendar availability', () => {
  it('validates intervals and meeting types without silently repairing overlaps', () => {
    expect(validateBookingAvailabilityDraft(availability)).toMatchObject({ advisorTimezone: 'UTC' });
    expect(() => validateBookingAvailabilityDraft({
      ...availability,
      workingHours: hours([
        { startLocal: '09:00', endLocal: '10:00' },
        { startLocal: '09:30', endLocal: '11:00' },
      ]),
    })).toThrow(/must not overlap/);
    expect(() => validateBookingAvailabilityDraft({
      ...availability,
      meetingTypes: [{ ...introMeeting, durationMinutes: 0 }],
    })).toThrow(/duration/);
  });

  it('applies notice, horizon, duration, buffers, working hours, and opaque busy time', () => {
    const range = { startUtc: '2026-08-03T08:00:00Z', endUtc: '2026-08-03T12:00:00Z' };
    const busyBlocks = getBusyBlocks(range, {
      capability: defaultCalendarCapabilityState(),
      localOccurrences: [{
        occurrenceKey: 'private-event@2026-08-03T09:30:00Z',
        sourceEventId: 'private-event',
        kind: 'calendar_event',
        title: 'Private client title',
        startUtc: '2026-08-03T09:30:00Z',
        endUtc: '2026-08-03T10:00:00Z',
        displayTimezone: 'UTC',
        allDay: false,
        calendarId: 'calendar:local',
        status: 'scheduled',
      }],
    });
    expect(JSON.stringify(busyBlocks)).not.toContain('Private client title');
    expect(busyBlocks).toEqual([{
      startUtc: '2026-08-03T09:30:00Z', endUtc: '2026-08-03T10:00:00Z', calendarId: 'calendar:local',
    }]);

    const slots = getBookableSlots({
      availability,
      range,
      busyBlocks,
      meetingTypeId: 'intro',
      nowUtc: '2026-08-03T07:00:00Z',
    });
    expect(slots.map((slot) => slot.startUtc)).toEqual(['2026-08-03T10:15:00Z', '2026-08-03T10:30:00Z']);
  });

  it('uses only selected blockers and never leaks display fields', () => {
    const blocks = getBusyBlocks(
      { startUtc: '2026-08-03T00:00:00Z', endUtc: '2026-08-04T00:00:00Z' },
      {
        capability: defaultCalendarCapabilityState(),
        localOccurrences: [],
        externalReadProjections: [{
          occurrenceKey: 'external-1', source: 'external-read-only', sourceEventId: 'provider-secret',
          calendarId: 'not-selected', title: 'Secret title', startUtc: '2026-08-03T09:00:00Z',
          endUtc: '2026-08-03T10:00:00Z', allDay: false, status: 'scheduled',
        }],
      },
    );
    expect(blocks).toEqual([]);
  });
});
