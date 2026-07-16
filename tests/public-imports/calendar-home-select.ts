import { toCalendarSelectionProjection, useCalendarCapabilityStore } from '@/features/calendar';

export function useHomeCalendarPublicContract() {
  const store = useCalendarCapabilityStore();
  return store.setSelection(store.state.homeCalendarId, store.state.busyCalendarIds).then(toCalendarSelectionProjection);
}
