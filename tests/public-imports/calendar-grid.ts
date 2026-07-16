import { toCalendarGridItems, useCalendarEventStore, type CalendarRange } from '@/features/calendar';

export function useCalendarGridPublicContract(range: CalendarRange) {
  const store = useCalendarEventStore();
  return store.listOccurrences(range).then(toCalendarGridItems);
}
