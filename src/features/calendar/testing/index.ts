import { renderHook, waitFor } from '@testing-library/react';
import {
  useBookingAvailabilityStore,
  useCalendarCapabilityStore,
  useCalendarEventStore,
  type BookingAvailabilityDraft,
  type BookingAvailabilityRecord,
  type CalendarCapabilityDraft,
  type CalendarCapabilityState,
  type CalendarEventDraft,
  type CalendarEventRecord,
} from '@/features/calendar';

export interface CalendarFoundationRoundTripInput {
  readonly event?: CalendarEventDraft;
  readonly capability?: CalendarCapabilityDraft;
  readonly availability?: BookingAvailabilityDraft;
}

export interface CalendarFoundationRoundTripResult {
  readonly event?: CalendarEventRecord;
  readonly capability?: CalendarCapabilityState;
  readonly availability?: BookingAvailabilityRecord;
}

/**
 * Public test paved path for canonical calendar persistence.
 *
 * Each writer must return its reloaded `crm_live_list` projection. A fresh
 * hook then independently checks that returned value before this helper
 * exposes it, so an upsert response or memory clone cannot hide here.
 */
export async function roundTripCalendarFoundation(
  input: CalendarFoundationRoundTripInput,
): Promise<CalendarFoundationRoundTripResult> {
  let eventId: string | undefined;
  let writtenEvent: CalendarEventRecord | undefined;
  let writtenCapability: CalendarCapabilityState | undefined;
  let writtenAvailability: BookingAvailabilityRecord | undefined;
  if (input.event) {
    const writer = renderHook(() => useCalendarEventStore());
    try {
      const beforeInitialReload = writer.result.current;
      await waitFor(() => {
        if (writer.result.current === beforeInitialReload) {
          throw new Error('The calendar event store has not loaded its canonical records yet.');
        }
      });
      writtenEvent = await writer.result.current.create(input.event);
      eventId = writtenEvent.id;
    } finally {
      writer.unmount();
    }
  }
  if (input.capability) {
    const writer = renderHook(() => useCalendarCapabilityStore());
    try {
      writtenCapability = await writer.result.current.save(input.capability);
    } finally {
      writer.unmount();
    }
  }
  if (input.availability) {
    const writer = renderHook(() => useBookingAvailabilityStore());
    try {
      writtenAvailability = await writer.result.current.save(input.availability);
    } finally {
      writer.unmount();
    }
  }

  let event: CalendarEventRecord | undefined;
  let capability: CalendarCapabilityState | undefined;
  let availability: BookingAvailabilityRecord | undefined;
  const reader = renderHook(() => ({
    events: useCalendarEventStore(),
    capabilities: useCalendarCapabilityStore(),
    bookingAvailability: useBookingAvailabilityStore(),
  }));
  try {
    await waitFor(async () => {
      if (eventId) {
        event = await reader.result.current.events.get(eventId);
        if (!event) throw new Error('The saved calendar event has not reloaded yet.');
        if (JSON.stringify(event) !== JSON.stringify(writtenEvent)) {
          throw new Error('The event write did not return the fresh canonical projection.');
        }
      }
      if (input.capability) {
        capability = await reader.result.current.capabilities.get();
        if (capability.homeCalendarId !== input.capability.homeCalendarId) {
          throw new Error('The saved calendar capability has not reloaded yet.');
        }
        if (JSON.stringify(capability) !== JSON.stringify(writtenCapability)) {
          throw new Error('The calendar capability write did not return the fresh canonical projection.');
        }
      }
      if (input.availability) {
        availability = await reader.result.current.bookingAvailability.get();
        if (availability.advisorTimezone !== input.availability.advisorTimezone) {
          throw new Error('The saved booking availability has not reloaded yet.');
        }
        if (JSON.stringify(availability) !== JSON.stringify(writtenAvailability)) {
          throw new Error('The booking availability write did not return the fresh canonical projection.');
        }
      }
    });
  } finally {
    reader.unmount();
  }
  return {
    ...(writtenEvent ? { event: writtenEvent } : {}),
    ...(writtenCapability ? { capability: writtenCapability } : {}),
    ...(writtenAvailability ? { availability: writtenAvailability } : {}),
  };
}

export async function roundTripCalendarEvent(draft: CalendarEventDraft): Promise<CalendarEventRecord> {
  const result = await roundTripCalendarFoundation({ event: draft });
  if (!result.event) throw new Error('The calendar event did not reload.');
  return result.event;
}
