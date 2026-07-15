/** @deprecated Compatibility types. New calendar and booking work imports from '@/platform/calendar'. */
export type {
  AvailabilityRule,
  BookableSlot,
  BookingRequest,
  BookingRequestStatus,
  BookingSlug,
  BusyFreeSnapshot,
  LocalTimeRange,
  MeetingType,
  OpaqueBusyBlock,
  Weekday,
  WorkingHoursByWeekday,
} from '@/platform/calendar';

import type { Weekday } from '@/platform/calendar';

export const WEEKDAYS: readonly Weekday[] = [
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
];
