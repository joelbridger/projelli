import { BookingAvailabilitySettingsMount } from './BookingAvailabilitySettings';

/** Scheduling panel mount; the Settings registry owns the public composition point. */
export const bookingAvailabilitySettingsPanel = {
  id: 'booking-availability',
  section: 'scheduling',
  order: 10,
  labelKey: 'booking-availability.title',
  flagId: 'booking-availability',
  searchTerms: [
    'booking availability',
    'working hours',
    'meeting type',
    'busy calendar',
    'minimum notice',
    'timezone',
  ],
  render: BookingAvailabilitySettingsMount,
} as const;
