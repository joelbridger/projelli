export type CalendarProviderId = 'outlook' | 'google' | 'ics';

export interface CalendarAttendeeDto {
  email: string;
  name: string;
}

export interface CalendarEventDto {
  id: string;
  provider: CalendarProviderId;
  title: string;
  startUtc: string;
  endUtc: string;
  attendees: CalendarAttendeeDto[];
  organizerEmail: string;
  isCancelled?: boolean;
  selfDeclined?: boolean;
  joinUrl?: string;
}

export interface CalendarSyncReport {
  eventsFetched: number;
  eventsChanged: number;
  eventsIndexed: number;
  recordsIndexed: number;
  cancelled: boolean;
}

export interface CalendarSyncStatus {
  syncing: boolean;
  eventsIndexed: number;
  lastReport: CalendarSyncReport | null;
}

export interface CalendarSyncProgress {
  status: 'syncing' | 'done' | 'cancelled' | 'error';
  eventsIndexed: number;
  error?: string;
}
