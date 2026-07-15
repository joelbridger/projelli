import type { StateCreator } from 'zustand';
import type { AvailabilityRule, MeetingType, Weekday } from './types';
import type { SchedulingStoreState } from './stateContract';

type SchedulingSet = Parameters<StateCreator<SchedulingStoreState>>[0];

/** Feature-owned availability state. Keep calendar-specific state out of the shell. */
export function createAvailabilityStateContribution(set: SchedulingSet) {
  return {
    setDayEnabled: (weekday: Weekday, enabled: boolean) => {
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
    updateWorkingHours: (weekday: Weekday, updates: { startLocal?: string; endLocal?: string }) => {
      set((state) => {
        const current = state.availabilityRule.workingHours[weekday][0] ?? { startLocal: '09:00', endLocal: '17:00' };
        return {
          availabilityRule: {
            ...state.availabilityRule,
            workingHours: { ...state.availabilityRule.workingHours, [weekday]: [{ ...current, ...updates }] },
          },
        };
      });
    },
    addMeetingType: (meetingType: Partial<MeetingType> = {}) => {
      const name = (meetingType.name ?? 'New meeting type').trim() || 'New meeting type';
      const id = meetingType.id ?? createMeetingTypeId(name);
      set((state) => ({
        availabilityRule: {
          ...state.availabilityRule,
          meetingTypes: [...state.availabilityRule.meetingTypes, {
            id, name, durationMin: clampPositiveInt(meetingType.durationMin ?? 30),
            bufferBeforeMin: clampNonNegativeInt(meetingType.bufferBeforeMin ?? 0),
            bufferAfterMin: clampNonNegativeInt(meetingType.bufferAfterMin ?? 15),
          }],
        },
      }));
      return id;
    },
    updateMeetingType: (meetingTypeId: string, updates: Partial<AvailabilityRule['meetingTypes'][number]>) => {
      set((state) => ({
        availabilityRule: {
          ...state.availabilityRule,
          meetingTypes: state.availabilityRule.meetingTypes.map((type) => type.id === meetingTypeId ? {
            ...type, ...updates,
            durationMin: clampPositiveInt(updates.durationMin ?? type.durationMin),
            bufferBeforeMin: clampNonNegativeInt(updates.bufferBeforeMin ?? type.bufferBeforeMin),
            bufferAfterMin: clampNonNegativeInt(updates.bufferAfterMin ?? type.bufferAfterMin),
          } : type),
        },
      }));
    },
    removeMeetingType: (meetingTypeId: string) => {
      set((state) => {
        if (state.availabilityRule.meetingTypes.length <= 1) return state;
        return { availabilityRule: { ...state.availabilityRule, meetingTypes: state.availabilityRule.meetingTypes.filter((type) => type.id !== meetingTypeId) } };
      });
    },
    setMinNoticeHours: (hours: number) => {
      set((state) => ({ availabilityRule: { ...state.availabilityRule, minNoticeHours: clampNonNegativeInt(hours) } }));
    },
    setMaxHorizonDays: (days: number) => {
      set((state) => ({ availabilityRule: { ...state.availabilityRule, maxHorizonDays: clampPositiveInt(days) } }));
    },
  };
}

/** Feature-owned booking state, ready for future booking-page contributions. */
export function createBookingStateContribution(set: SchedulingSet) {
  return {
    setBookingSlug: (slug: string) => {
      set((state) => ({ bookingSlug: { ...state.bookingSlug, slug: sanitizeSlug(slug) } }));
    },
    confirmBookingRequest: (requestId: string) => {
      set((state) => ({ bookingRequests: state.bookingRequests.map((request) => request.id === requestId ? { ...request, status: 'confirmed' } : request) }));
    },
    declineBookingRequest: (requestId: string) => {
      set((state) => ({ bookingRequests: state.bookingRequests.map((request) => request.id === requestId ? { ...request, status: 'declined' } : request) }));
    },
  };
}

function sanitizeSlug(slug: string): string { return slug.trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80); }
function createMeetingTypeId(name: string): string {
  const base = sanitizeSlug(name) || 'meeting';
  const random = typeof globalThis.crypto.randomUUID === 'function' ? globalThis.crypto.randomUUID().slice(0, 8) : Date.now().toString(36);
  return `${base}-${random}`;
}
function clampPositiveInt(value: number): number { return Math.max(1, Math.round(value)); }
function clampNonNegativeInt(value: number): number { return Math.max(0, Math.round(value)); }
