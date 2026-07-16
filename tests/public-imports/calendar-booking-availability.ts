import { getBookableSlots, getBusyBlocks, useBookingAvailabilityStore, useCalendarCapabilityStore, type CalendarOccurrence, type CalendarRange } from '@/features/calendar';

export function useBookingAvailabilityPublicContract(range: CalendarRange, localOccurrences: readonly CalendarOccurrence[]) {
  const capability = useCalendarCapabilityStore();
  const availability = useBookingAvailabilityStore();
  const busyBlocks = getBusyBlocks(range, { capability: capability.state, localOccurrences });
  return getBookableSlots({ availability: availability.availability, range, busyBlocks });
}
