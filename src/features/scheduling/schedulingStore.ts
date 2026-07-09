import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type {
  AvailabilityRule,
  BookingRequest,
  BookingSlug,
  MeetingType,
  Weekday,
  WorkingHoursByWeekday,
} from './types';

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
  bookingRequests: BookingRequest[];
  getDefaultAvailabilityRule: () => AvailabilityRule;
  setBookingSlug: (slug: string) => void;
  setDayEnabled: (weekday: Weekday, enabled: boolean) => void;
  updateWorkingHours: (weekday: Weekday, updates: { startLocal?: string; endLocal?: string }) => void;
  addMeetingType: (meetingType?: Partial<MeetingType>) => string;
  updateMeetingType: (
    meetingTypeId: string,
    updates: Partial<AvailabilityRule['meetingTypes'][number]>,
  ) => void;
  removeMeetingType: (meetingTypeId: string) => void;
  confirmBookingRequest: (requestId: string) => void;
  declineBookingRequest: (requestId: string) => void;
  setMinNoticeHours: (hours: number) => void;
  setMaxHorizonDays: (days: number) => void;
}

export const useSchedulingStore = create<SchedulingState>()(
  persist(
    (set) => ({
      availabilityRule: defaultAvailabilityRule(),
      bookingSlug: { slug: 'my-booking-link', enabled: true },
      bookingRequests: [],
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
      addMeetingType: (meetingType = {}) => {
        const name = (meetingType.name ?? 'New meeting type').trim() || 'New meeting type';
        const id = meetingType.id ?? createMeetingTypeId(name);
        set((state) => ({
          availabilityRule: {
            ...state.availabilityRule,
            meetingTypes: [
              ...state.availabilityRule.meetingTypes,
              {
                id,
                name,
                durationMin: clampPositiveInt(meetingType.durationMin ?? 30),
                bufferBeforeMin: clampNonNegativeInt(meetingType.bufferBeforeMin ?? 0),
                bufferAfterMin: clampNonNegativeInt(meetingType.bufferAfterMin ?? 15),
              },
            ],
          },
        }));
        return id;
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
      removeMeetingType: (meetingTypeId) => {
        set((state) => {
          if (state.availabilityRule.meetingTypes.length <= 1) return state;
          return {
            availabilityRule: {
              ...state.availabilityRule,
              meetingTypes: state.availabilityRule.meetingTypes.filter((type) => type.id !== meetingTypeId),
            },
          };
        });
      },
      confirmBookingRequest: (requestId) => {
        set((state) => ({
          bookingRequests: state.bookingRequests.map((request) =>
            request.id === requestId ? { ...request, status: 'confirmed' } : request,
          ),
        }));
      },
      declineBookingRequest: (requestId) => {
        set((state) => ({
          bookingRequests: state.bookingRequests.map((request) =>
            request.id === requestId ? { ...request, status: 'declined' } : request,
          ),
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

function createMeetingTypeId(name: string): string {
  const base = sanitizeSlug(name) || 'meeting';
  const random =
    typeof globalThis.crypto.randomUUID === 'function'
      ? globalThis.crypto.randomUUID().slice(0, 8)
      : Date.now().toString(36);
  return `${base}-${random}`;
}

function clampPositiveInt(value: number): number {
  return Math.max(1, Math.round(value));
}

function clampNonNegativeInt(value: number): number {
  return Math.max(0, Math.round(value));
}
