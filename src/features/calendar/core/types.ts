export const CALENDAR_WEEKDAYS = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
] as const;

export type CalendarWeekday = (typeof CALENDAR_WEEKDAYS)[number];
export type CalendarEventStatus = 'scheduled' | 'cancelled';

export interface CalendarRange {
  readonly startUtc: string;
  readonly endUtc: string;
}

export interface CalendarRecurrenceRule {
  readonly frequency: 'daily' | 'weekly' | 'monthly' | 'yearly';
  readonly interval: number;
  readonly count?: number;
  readonly untilUtc?: string;
  readonly byWeekday?: readonly CalendarWeekday[];
  readonly byMonthDay?: readonly number[];
}

export interface CalendarContextReference {
  readonly kind: 'household' | 'record';
  readonly id: string;
  readonly matterId?: string;
  readonly label?: string;
}

export interface CalendarEventDraft {
  readonly title: string;
  readonly notes?: string;
  readonly startUtc: string;
  readonly endUtc: string;
  readonly displayTimezone: string;
  readonly allDay: boolean;
  readonly calendarId: string;
  readonly contextRef?: CalendarContextReference;
  readonly recurrence?: CalendarRecurrenceRule;
}

/** A deliberately thin patch. Calendar moves and occurrence edits are not Part A. */
export interface CalendarEventPatch {
  readonly title?: string;
  readonly notes?: string | null;
  readonly startUtc?: string;
  readonly endUtc?: string;
  readonly displayTimezone?: string;
  readonly allDay?: boolean;
  readonly contextRef?: CalendarContextReference | null;
  readonly recurrence?: CalendarRecurrenceRule | null;
}

export interface CalendarEventRecord {
  readonly id: string;
  readonly kind: 'calendar_event';
  readonly title: string;
  readonly notes?: string;
  readonly startUtc: string;
  readonly endUtc: string;
  readonly displayTimezone: string;
  readonly allDay: boolean;
  readonly calendarId: string;
  readonly status: CalendarEventStatus;
  readonly contextRef?: CalendarContextReference;
  readonly seriesId?: string;
  readonly recurrence?: CalendarRecurrenceRule;
}

export interface CalendarOccurrence {
  readonly occurrenceKey: string;
  readonly sourceEventId: string;
  readonly seriesId?: string;
  readonly kind: 'calendar_event';
  readonly title: string;
  readonly startUtc: string;
  readonly endUtc: string;
  readonly displayTimezone: string;
  readonly allDay: boolean;
  readonly calendarId: string;
  readonly status: CalendarEventStatus;
  readonly contextRef?: CalendarContextReference;
}

export interface CalendarEventStore {
  readonly events: readonly CalendarEventRecord[];
  readonly error: string | null;
  create(draft: CalendarEventDraft): Promise<CalendarEventRecord>;
  update(id: string, patch: CalendarEventPatch): Promise<CalendarEventRecord>;
  cancel(id: string): Promise<CalendarEventRecord>;
  get(id: string): Promise<CalendarEventRecord | undefined>;
  listOccurrences(range: CalendarRange): Promise<readonly CalendarOccurrence[]>;
}

export interface CalendarDescriptor {
  readonly id: string;
  readonly label: string;
  readonly ownership: 'local' | 'external-read-only';
  readonly canBlockBusyTime: boolean;
}

export interface CalendarCapabilityState {
  readonly scope: 'active-workspace-advisor';
  readonly advisorId: string;
  readonly calendars: readonly CalendarDescriptor[];
  readonly homeCalendarId: string;
  readonly busyCalendarIds: readonly string[];
}

export interface CalendarCapabilityDraft {
  readonly calendars: readonly CalendarDescriptor[];
  readonly homeCalendarId: string;
  readonly busyCalendarIds: readonly string[];
}

export interface CalendarCapabilityStore {
  readonly state: CalendarCapabilityState;
  readonly error: string | null;
  get(): Promise<CalendarCapabilityState>;
  save(draft: CalendarCapabilityDraft): Promise<CalendarCapabilityState>;
  setSelection(homeCalendarId: string, busyCalendarIds: readonly string[]): Promise<CalendarCapabilityState>;
}

export interface CalendarLocalTimeRange {
  readonly startLocal: string;
  readonly endLocal: string;
}

export type CalendarWorkingHours = Readonly<Record<CalendarWeekday, readonly CalendarLocalTimeRange[]>>;

export interface CalendarMeetingType {
  readonly id: string;
  readonly name: string;
  readonly durationMinutes: number;
  readonly bufferBeforeMinutes: number;
  readonly bufferAfterMinutes: number;
}

export interface BookingAvailabilityDraft {
  readonly advisorTimezone: string;
  readonly workingHours: CalendarWorkingHours;
  readonly meetingTypes: readonly CalendarMeetingType[];
  readonly minimumNoticeMinutes: number;
  readonly maximumHorizonDays: number;
}

export interface BookingAvailabilityRecord extends BookingAvailabilityDraft {
  readonly id: string;
  readonly kind: 'booking_availability';
  readonly scope: 'active-workspace-advisor';
  readonly advisorId: string;
}

export interface BookingAvailabilityStore {
  readonly availability: BookingAvailabilityRecord;
  readonly error: string | null;
  get(): Promise<BookingAvailabilityRecord>;
  save(draft: BookingAvailabilityDraft): Promise<BookingAvailabilityRecord>;
}

export interface CalendarSettingsDraft {
  readonly capability: CalendarCapabilityDraft;
  readonly availability: BookingAvailabilityDraft;
}

export interface CalendarSettingsState {
  readonly capability: CalendarCapabilityState;
  readonly availability: BookingAvailabilityRecord;
}

/** One durable aggregate write for settings that are presented as one Save action. */
export interface CalendarSettingsStore {
  readonly error: string | null;
  get(): Promise<CalendarSettingsState>;
  save(draft: CalendarSettingsDraft): Promise<CalendarSettingsState>;
}

export interface OpaqueCalendarBusyBlock {
  readonly startUtc: string;
  readonly endUtc: string;
  readonly calendarId: string;
}

export interface CalendarBookableSlot {
  readonly id: string;
  readonly meetingTypeId: string;
  readonly startUtc: string;
  readonly endUtc: string;
  readonly advisorTimezone: string;
}

export interface CalendarReadProjection {
  readonly occurrenceKey: string;
  readonly source: 'local' | 'external-read-only';
  readonly sourceEventId: string;
  readonly calendarId: string;
  readonly title: string;
  readonly startUtc: string;
  readonly endUtc: string;
  readonly allDay: boolean;
  readonly status: CalendarEventStatus;
}
