import {
  getBookableSlots,
  getBusyBlocks,
  toBookingPageAvailabilityConsumer,
  type BookingAvailabilityRecord,
  type BookingPageAvailabilityConsumerContract,
  type CalendarCapabilityState,
  type CalendarOccurrence,
  type CalendarRange,
} from '@/features/calendar';

interface CalendarBookingAvailabilityInput {
  readonly availability: BookingAvailabilityRecord;
  readonly capability: CalendarCapabilityState;
  readonly occurrences: readonly CalendarOccurrence[];
  readonly range: CalendarRange;
  readonly nowUtc?: string;
  readonly locale?: string;
}

/**
 * The only calendar-to-public-page seam. It passes display-ready slots through
 * the foundation adapter and cannot expose events, persistence, or holds.
 */
export function toCalendarBookingPageAvailabilityConsumer(
  input: CalendarBookingAvailabilityInput,
): BookingPageAvailabilityConsumerContract {
  const busyBlocks = getBusyBlocks(input.range, {
    capability: input.capability,
    localOccurrences: input.occurrences,
  });
  const slots = getBookableSlots({
    availability: input.availability,
    busyBlocks,
    range: input.range,
    ...(input.nowUtc === undefined ? {} : { nowUtc: input.nowUtc }),
  });
  return toBookingPageAvailabilityConsumer({
    advisorTimezone: input.availability.advisorTimezone,
    slots,
    state: 'available',
    ...(input.locale === undefined ? {} : { locale: input.locale }),
  });
}

export function loadingCalendarBookingPageConsumer(): BookingPageAvailabilityConsumerContract {
  return toBookingPageAvailabilityConsumer({ state: 'loading' });
}

export function unavailableCalendarBookingPageConsumer(): BookingPageAvailabilityConsumerContract {
  return toBookingPageAvailabilityConsumer({ state: 'unavailable' });
}
