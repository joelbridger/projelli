import { describe, expect, it } from 'vitest';
import { useCalendarGridPublicContract } from './calendar-grid';
import { useCalendarEditorPublicContract } from './calendar-add-event';
import { useCalendarListPublicContract } from './calendar-event-list';
import { useMeetingSchedulePublicContract } from './calendar-meeting-schedule';
import { useHomeCalendarPublicContract } from './calendar-home-select';
import { useBookingAvailabilityPublicContract } from './calendar-booking-availability';
import { useRecordQuickAddPublicContract } from './calendar-record-quick-add';
import { bookingPublicPageContract } from './calendar-booking-public-page';
import { fixtureVersionedRead } from './calendar-versioned-read';
import { calendarRoundTripPublicContract } from './calendar-testing-harness';
import { calendarAddEventSurfacePublicContract } from './calendar-add-event-surface';

describe('calendar foundation public imports', () => {
  it('compiles every Part A dependent through public indexes only', () => {
    expect(useCalendarGridPublicContract).toBeTypeOf('function');
    expect(useCalendarEditorPublicContract).toBeTypeOf('function');
    expect(useCalendarListPublicContract).toBeTypeOf('function');
    expect(useMeetingSchedulePublicContract).toBeTypeOf('function');
    expect(useHomeCalendarPublicContract).toBeTypeOf('function');
    expect(useBookingAvailabilityPublicContract).toBeTypeOf('function');
    expect(useRecordQuickAddPublicContract).toBeTypeOf('function');
    expect(bookingPublicPageContract).toBeTypeOf('function');
    expect(fixtureVersionedRead.source).toBe('external-read-only');
    expect(calendarRoundTripPublicContract).toBeTypeOf('function');
    expect(calendarAddEventSurfacePublicContract.id).toBe('calendar-add-event');
  });
});
