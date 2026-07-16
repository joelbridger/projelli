/**
 * Calendar Part A public doorway.
 *
 * Durable event, capability, and availability records are scoped to the active
 * workspace and local advisor. They use the encrypted CRM live-record route;
 * they are not firm-wide defaults and they never fall back to browser storage.
 * External projections are read-only. Provider writes, holds, confirmations,
 * OAuth, receipts, and native calendar changes are deliberately absent.
 *
 * Paved path: ./SKILL.md
 */
export {
  createDraftFromRecord,
  useCalendarEventStore,
  type CalendarRecordDraftDefaults,
} from './eventStore';
export {
  expandCalendarEvent,
  expandCalendarEvents,
  validateCalendarRecurrence,
  weekdayForUtc,
} from './recurrence';
export {
  defaultBookingAvailability,
  defaultCalendarCapabilityState,
  useBookingAvailabilityStore,
  useCalendarCapabilityStore,
  validateBookingAvailabilityDraft,
  validateCalendarCapabilityDraft,
} from './settingsStores';
export { getBookableSlots, getBusyBlocks, type BookableSlotInput, type BusyBlockOptions } from './availability';
export {
  calendarProjectionRegistry,
  canonicalLocalCalendarProjection,
  composeCalendarReadProjections,
  validateCalendarProjectionDescriptors,
  type CalendarProjectionDescriptor,
  type CalendarProjectionId,
  type CalendarProjectionRuntime,
} from './projectionRegistry';
export {
  toCalendarEventListItems,
  toCalendarGridItems,
  toCalendarSelectionProjection,
  toMeetingScheduleItems,
  type CalendarEventListItem,
  type CalendarGridItem,
  type CalendarMeetingScheduleItem,
  type CalendarSelectionProjection,
} from './projections';
export {
  toBookingPageAvailabilityConsumer,
  type BookingAvailabilityConsumerInput,
  type BookingPageAvailabilityConsumerContract,
} from './bookingAdapter';
export { validateCalendarEventDraft, validateContextReference, validateRecurrenceRule } from './validation';
export { MAX_CALENDAR_RANGE_DAYS } from './time';
export type {
  BookingAvailabilityDraft,
  BookingAvailabilityRecord,
  BookingAvailabilityStore,
  CalendarBookableSlot,
  CalendarCapabilityDraft,
  CalendarCapabilityState,
  CalendarCapabilityStore,
  CalendarContextReference,
  CalendarDescriptor,
  CalendarEventDraft,
  CalendarEventPatch,
  CalendarEventRecord,
  CalendarEventStatus,
  CalendarEventStore,
  CalendarLocalTimeRange,
  CalendarMeetingType,
  CalendarOccurrence,
  CalendarRange,
  CalendarReadProjection,
  CalendarRecurrenceRule,
  CalendarWeekday,
  CalendarWorkingHours,
  OpaqueCalendarBusyBlock,
} from './types';
