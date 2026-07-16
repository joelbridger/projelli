import {
  CalendarFoundationError,
  useCalendarEventStore,
  type CalendarEventDraft,
  type CalendarEventPatch,
  type CalendarFoundationErrorCode,
} from '@/features/calendar';

export function useCalendarEditorPublicContract(draft: CalendarEventDraft, patch: CalendarEventPatch) {
  const store = useCalendarEventStore();
  return store.create(draft).then((event) => store.update(event.id, patch)).then((event) => store.cancel(event.id));
}

export function calendarWriteFailureCode(error: unknown): CalendarFoundationErrorCode | undefined {
  return error instanceof CalendarFoundationError ? error.code : undefined;
}
