export {
  markAutoJoinOccurrenceStarted,
  markAutoJoinOccurrencesPresented,
  readAutoJoinCalendarPrefs,
  readDisabledAutoJoinEventKeys,
  readPresentedAutoJoinOccurrenceKeys,
  readStartedAutoJoinOccurrenceKeys,
  setAutoJoinCalendarPref,
  setAutoJoinEventDisabled,
  useAutoJoinCalendarPrefs,
  useDisabledAutoJoinEventKeys,
} from '@/platform/connectors/calendar/autoJoinSettings';
export type { AutoJoinCalendarPrefs } from '@/platform/connectors/calendar/autoJoinSettings';
