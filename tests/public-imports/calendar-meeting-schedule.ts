import { toCalendarSelectionProjection, toMeetingScheduleItems, useCalendarCapabilityStore, useCalendarEventStore, type CalendarRange } from '@/features/calendar';

export function useMeetingSchedulePublicContract(range: CalendarRange) {
  const events = useCalendarEventStore();
  const capabilities = useCalendarCapabilityStore();
  return events.listOccurrences(range).then((occurrences) => ({
    schedule: toMeetingScheduleItems(occurrences),
    calendarSelection: toCalendarSelectionProjection(capabilities.state),
  }));
}
