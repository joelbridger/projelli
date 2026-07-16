import { createDraftFromRecord, useCalendarEventStore, type CalendarContextReference } from '@/features/calendar';

export function useRecordQuickAddPublicContract(context: CalendarContextReference) {
  const store = useCalendarEventStore();
  return store.create(createDraftFromRecord(context, {
    startUtc: '2026-08-03T14:00:00Z',
    endUtc: '2026-08-03T14:30:00Z',
    displayTimezone: 'UTC',
    calendarId: 'calendar:local',
  }));
}
