import type { CalendarCapabilityState, CalendarOccurrence } from './types';

export interface CalendarGridItem {
  readonly occurrenceKey: string;
  readonly eventId: string;
  readonly calendarId: string;
  readonly title: string;
  readonly startUtc: string;
  readonly endUtc: string;
  readonly allDay: boolean;
}

export interface CalendarEventListItem extends CalendarGridItem {
  readonly kind: 'calendar_event';
}

export interface CalendarMeetingScheduleItem {
  readonly occurrenceKey: string;
  readonly calendarId: string;
  readonly title: string;
  readonly startUtc: string;
  readonly endUtc: string;
}

export interface CalendarSelectionProjection {
  readonly calendars: CalendarCapabilityState['calendars'];
  readonly homeCalendarId: string;
  readonly busyCalendarIds: readonly string[];
}

export function toCalendarGridItems(occurrences: readonly CalendarOccurrence[]): readonly CalendarGridItem[] {
  return occurrences.map((occurrence) => ({
    occurrenceKey: occurrence.occurrenceKey,
    eventId: occurrence.sourceEventId,
    calendarId: occurrence.calendarId,
    title: occurrence.title,
    startUtc: occurrence.startUtc,
    endUtc: occurrence.endUtc,
    allDay: occurrence.allDay,
  }));
}

export function toCalendarEventListItems(occurrences: readonly CalendarOccurrence[]): readonly CalendarEventListItem[] {
  return toCalendarGridItems(occurrences).map((item) => ({ ...item, kind: 'calendar_event' }));
}

export function toMeetingScheduleItems(occurrences: readonly CalendarOccurrence[]): readonly CalendarMeetingScheduleItem[] {
  return occurrences.map((occurrence) => ({
    occurrenceKey: occurrence.occurrenceKey,
    calendarId: occurrence.calendarId,
    title: occurrence.title,
    startUtc: occurrence.startUtc,
    endUtc: occurrence.endUtc,
  }));
}

export function toCalendarSelectionProjection(state: CalendarCapabilityState): CalendarSelectionProjection {
  return {
    calendars: state.calendars,
    homeCalendarId: state.homeCalendarId,
    busyCalendarIds: state.busyCalendarIds,
  };
}
