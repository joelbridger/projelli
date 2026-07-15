import type { ReactNode } from 'react';

export type Weekday =
  | 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday' | 'sunday';
export interface LocalTimeRange { startLocal: string; endLocal: string; }
export type WorkingHoursByWeekday = Record<Weekday, LocalTimeRange[]>;
export interface MeetingType { id: string; name: string; durationMin: number; bufferBeforeMin: number; bufferAfterMin: number; }
export interface AvailabilityRule { workingHours: WorkingHoursByWeekday; meetingTypes: MeetingType[]; minNoticeHours: number; maxHorizonDays: number; }
export interface BookingSlug { slug: string; enabled: boolean; }
export interface BookingRequest { id: string; meetingTypeId: string; requestedSlotUtc: string; clientName: string; clientEmail: string; status: BookingRequestStatus; createdUtc: string; }
export type BookingRequestStatus = 'pending' | 'confirmed' | 'declined' | 'expired';
export interface BookableSlot { meetingTypeId: string; meetingTypeName: string; startUtc: string; endUtc: string; advisorTimezone: string; durationMin: number; }
export interface OpaqueBusyBlock { startUtc: string; endUtc: string; }
export interface BusyFreeSnapshot { busy: OpaqueBusyBlock[]; }

/** Feature descriptors augment this map beside their mount implementation. */
export interface SchedulingSurfaceMap {}
export type SchedulingSurfaceId = Extract<keyof SchedulingSurfaceMap, string>;
export type SchedulingSurfaceSlot = 'calendar-grid' | 'event-editor' | 'write-review' | 'availability' | 'booking-page';

/** Deliberately narrow stable state surface supplied to scheduling mounts. */
export interface SchedulingStateContract {
  availabilityRule: AvailabilityRule;
  bookingSlug: BookingSlug;
  bookingRequests: BookingRequest[];
  setBookingSlug(slug: string): void;
  setDayEnabled(weekday: Weekday, enabled: boolean): void;
  updateWorkingHours(weekday: Weekday, updates: Partial<LocalTimeRange>): void;
  addMeetingType(meetingType?: Partial<MeetingType>): string;
  updateMeetingType(meetingTypeId: string, updates: Partial<MeetingType>): void;
  removeMeetingType(meetingTypeId: string): void;
  confirmBookingRequest(requestId: string): void;
  declineBookingRequest(requestId: string): void;
  setMinNoticeHours(hours: number): void;
  setMaxHorizonDays(days: number): void;
}

export interface SchedulingSurfaceRuntime { state: SchedulingStateContract; }
export interface SchedulingSurfaceDescriptor {
  id: SchedulingSurfaceId;
  slot: SchedulingSurfaceSlot;
  order: number;
  mount(runtime: SchedulingSurfaceRuntime): ReactNode;
}
