import type { BookingPageAvailabilityConsumer } from '@/features/booking';
import { toBookingPageAvailabilityConsumer, type CalendarBookableSlot } from '@/features/calendar';

export function bookingPublicPageContract(slots: readonly CalendarBookableSlot[]): BookingPageAvailabilityConsumer {
  return toBookingPageAvailabilityConsumer({ state: 'available', slots, advisorTimezone: 'UTC' });
}
