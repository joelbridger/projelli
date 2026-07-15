import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type {
  AvailabilityRule,
  WorkingHoursByWeekday,
} from './types';
import type { SchedulingStoreState } from './stateContract';
import { createAvailabilityStateContribution, createBookingStateContribution } from './stateContributions';

const SCHEDULING_STORAGE_KEY = 'lantern:scheduling';

const DEFAULT_WORKING_HOURS: WorkingHoursByWeekday = {
  monday: [{ startLocal: '09:00', endLocal: '17:00' }],
  tuesday: [{ startLocal: '09:00', endLocal: '17:00' }],
  wednesday: [{ startLocal: '09:00', endLocal: '17:00' }],
  thursday: [{ startLocal: '09:00', endLocal: '17:00' }],
  friday: [{ startLocal: '09:00', endLocal: '17:00' }],
  saturday: [],
  sunday: [],
};

export function defaultAvailabilityRule(): AvailabilityRule {
  return {
    workingHours: cloneWorkingHours(DEFAULT_WORKING_HOURS),
    meetingTypes: [
      {
        id: 'intro',
        name: 'Intro call',
        durationMin: 30,
        bufferBeforeMin: 0,
        bufferAfterMin: 15,
      },
    ],
    minNoticeHours: 24,
    maxHorizonDays: 30,
  };
}

/** The compatibility store implements the public scheduling state contract. */
export const useSchedulingStore = create<SchedulingStoreState>()(
  persist(
    (set) => ({
      availabilityRule: defaultAvailabilityRule(),
      bookingSlug: { slug: 'my-booking-link', enabled: true },
      bookingRequests: [],
      getDefaultAvailabilityRule: defaultAvailabilityRule,
      ...createAvailabilityStateContribution(set),
      ...createBookingStateContribution(set),
    }),
    { name: SCHEDULING_STORAGE_KEY },
  ),
);

function cloneWorkingHours(hours: WorkingHoursByWeekday): WorkingHoursByWeekday {
  return {
    monday: [...hours.monday],
    tuesday: [...hours.tuesday],
    wednesday: [...hours.wednesday],
    thursday: [...hours.thursday],
    friday: [...hours.friday],
    saturday: [...hours.saturday],
    sunday: [...hours.sunday],
  };
}
