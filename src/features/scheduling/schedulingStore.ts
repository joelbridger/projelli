import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { AvailabilityRule, BookingSlug, Weekday, WorkingHoursByWeekday } from './types';

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

interface SchedulingState {
  availabilityRule: AvailabilityRule;
  bookingSlug: BookingSlug;
  getDefaultAvailabilityRule: () => AvailabilityRule;
  setBookingSlug: (slug: string) => void;
  setDayEnabled: (weekday: Weekday, enabled: boolean) => void;
  updateWorkingHours: (weekday: Weekday, updates: { startLocal?: string; endLocal?: string }) => void;
  updateMeetingType: (
    meetingTypeId: string,
    updates: Partial<AvailabilityRule['meetingTypes'][number]>,
  ) => void;
  setMinNoticeHours: (hours: number) => void;
  setMaxHorizonDays: (days: number) => void;
}

export const useSchedulingStore = create<SchedulingState>()(
  persist(
    (set) => ({
      availabilityRule: defaultAvailabilityRule(),
      bookingSlug: { slug: 'my-booking-link', enabled: true },
      getDefaultAvailabilityRule: defaultAvailabilityRule,
      setBookingSlug: (slug) => {
        set((state) => ({
          bookingSlug: {
            ...state.bookingSlug,
            slug: sanitizeSlug(slug),
          },
        }));
      },
      setDayEnabled: (weekday, enabled) => {
        set((state) => ({
          availabilityRule: {
            ...state.availabilityRule,
            workingHours: {
              ...state.availabilityRule.workingHours,
              [weekday]: enabled ? [{ startLocal: '09:00', endLocal: '17:00' }] : [],
            },
          },
        }));
      },
      updateWorkingHours: (weekday, updates) => {
        set((state) => {
          const current = state.availabilityRule.workingHours[weekday][0] ?? {
            startLocal: '09:00',
            endLocal: '17:00',
          };
          return {
            availabilityRule: {
              ...state.availabilityRule,
              workingHours: {
                ...state.availabilityRule.workingHours,
                [weekday]: [{ ...current, ...updates }],
              },
            },
          };
        });
      },
      updateMeetingType: (meetingTypeId, updates) => {
        set((state) => ({
          availabilityRule: {
            ...state.availabilityRule,
            meetingTypes: state.availabilityRule.meetingTypes.map((type) =>
              type.id === meetingTypeId
                ? {
                    ...type,
                    ...updates,
                    durationMin: clampPositiveInt(updates.durationMin ?? type.durationMin),
                    bufferBeforeMin: clampNonNegativeInt(updates.bufferBeforeMin ?? type.bufferBeforeMin),
                    bufferAfterMin: clampNonNegativeInt(updates.bufferAfterMin ?? type.bufferAfterMin),
                  }
                : type,
            ),
          },
        }));
      },
      setMinNoticeHours: (hours) => {
        set((state) => ({
          availabilityRule: {
            ...state.availabilityRule,
            minNoticeHours: clampNonNegativeInt(hours),
          },
        }));
      },
      setMaxHorizonDays: (days) => {
        set((state) => ({
          availabilityRule: {
            ...state.availabilityRule,
            maxHorizonDays: clampPositiveInt(days),
          },
        }));
      },
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

function sanitizeSlug(slug: string): string {
  return slug
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function clampPositiveInt(value: number): number {
  return Math.max(1, Math.round(value));
}

function clampNonNegativeInt(value: number): number {
  return Math.max(0, Math.round(value));
}
