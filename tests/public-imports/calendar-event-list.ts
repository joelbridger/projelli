import { toCalendarEventListItems, toMeetingScheduleItems, useCalendarEventStore, type CalendarRange } from '@/features/calendar';

export function useCalendarListPublicContract(range: CalendarRange) {
  const store = useCalendarEventStore();
  return store.listOccurrences(range).then((occurrences) => ({
    list: toCalendarEventListItems(occurrences),
    meetingSchedule: toMeetingScheduleItems(occurrences),
  }));
}
