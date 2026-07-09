export type Weekday =
  | 'monday'
  | 'tuesday'
  | 'wednesday'
  | 'thursday'
  | 'friday'
  | 'saturday'
  | 'sunday';

export const WEEKDAYS: Weekday[] = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
];

export interface LocalTimeRange {
  /** Advisor-local HH:mm time, e.g. 09:00. */
  startLocal: string;
  /** Advisor-local HH:mm time, e.g. 17:00. */
  endLocal: string;
}

export type WorkingHoursByWeekday = Record<Weekday, LocalTimeRange[]>;

export interface MeetingType {
  id: string;
  name: string;
  durationMin: number;
  bufferBeforeMin: number;
  bufferAfterMin: number;
}

export interface AvailabilityRule {
  workingHours: WorkingHoursByWeekday;
  meetingTypes: MeetingType[];
  minNoticeHours: number;
  maxHorizonDays: number;
}

export interface BookingSlug {
  slug: string;
  enabled: boolean;
}

export interface OpaqueBusyBlock {
  startUtc: string;
  endUtc: string;
}

export interface BusyFreeSnapshot {
  busy: OpaqueBusyBlock[];
}

export type BookingRequestStatus = 'pending' | 'confirmed' | 'declined' | 'expired';

export interface BookingRequest {
  id: string;
  meetingTypeId: string;
  requestedSlotUtc: string;
  clientName: string;
  clientEmail: string;
  status: BookingRequestStatus;
  createdUtc: string;
}

export interface BookableSlot {
  meetingTypeId: string;
  meetingTypeName: string;
  startUtc: string;
  endUtc: string;
  advisorTimezone: string;
  durationMin: number;
}
