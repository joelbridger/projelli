import { useCalendarEventStore, type CalendarEventDraft, type CalendarEventPatch } from '@/features/calendar';

export function useCalendarEditorPublicContract(draft: CalendarEventDraft, patch: CalendarEventPatch) {
  const store = useCalendarEventStore();
  return store.create(draft).then((event) => store.update(event.id, patch)).then((event) => store.cancel(event.id));
}
