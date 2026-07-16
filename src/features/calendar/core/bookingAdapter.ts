import type { CalendarBookableSlot } from './types';
import { parseUtc, zonedParts } from './time';

interface BookingPageDateOptionContract {
  readonly id: string;
  readonly label: string;
  readonly accessibleLabel: string;
}

interface BookingPageSlotOptionContract {
  readonly id: string;
  readonly label: string;
}

type BookingPageAvailabilityPresentationContract =
  | { readonly state: 'loading' }
  | { readonly state: 'unavailable'; readonly message?: string }
  | {
      readonly state: 'available';
      readonly dates: readonly BookingPageDateOptionContract[];
      readonly slotsByDate: Readonly<Record<string, readonly BookingPageSlotOptionContract[]>>;
    };

/** Structurally matches the booking feature's injected public consumer without importing that feature. */
export interface BookingPageAvailabilityConsumerContract {
  getPresentation(): BookingPageAvailabilityPresentationContract;
}

export type BookingAvailabilityConsumerInput =
  | { readonly state: 'loading' }
  | { readonly state: 'unavailable'; readonly message?: string }
  | {
      readonly state: 'available';
      readonly slots: readonly CalendarBookableSlot[];
      readonly advisorTimezone: string;
      readonly locale?: string;
    };

function presentation(input: BookingAvailabilityConsumerInput): BookingPageAvailabilityPresentationContract {
  if (input.state === 'loading') return { state: 'loading' };
  if (input.state === 'unavailable') {
    return input.message === undefined
      ? { state: 'unavailable' }
      : { state: 'unavailable', message: input.message };
  }
  if (input.slots.length === 0) return { state: 'unavailable' };

  const dates = new Map<string, BookingPageDateOptionContract>();
  const slotsByDate: Record<string, BookingPageSlotOptionContract[]> = {};
  const locale = input.locale ?? 'en-US';
  const dateFormatter = new Intl.DateTimeFormat(locale, {
    timeZone: input.advisorTimezone,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
  const accessibleDateFormatter = new Intl.DateTimeFormat(locale, {
    timeZone: input.advisorTimezone,
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
  const timeFormatter = new Intl.DateTimeFormat(locale, {
    timeZone: input.advisorTimezone,
    hour: 'numeric',
    minute: '2-digit',
  });

  for (const slot of input.slots) {
    const startMs = parseUtc(slot.startUtc, 'Booking slot start');
    const parts = zonedParts(startMs, input.advisorTimezone);
    const dateId = `${String(parts.year).padStart(4, '0')}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
    if (!dates.has(dateId)) {
      dates.set(dateId, {
        id: dateId,
        label: dateFormatter.format(startMs),
        accessibleLabel: accessibleDateFormatter.format(startMs),
      });
      slotsByDate[dateId] = [];
    }
    slotsByDate[dateId]?.push({ id: slot.id, label: timeFormatter.format(startMs) });
  }
  return { state: 'available', dates: [...dates.values()], slotsByDate };
}

/** Presentation-only adapter: it cannot save, hold, confirm, or call a provider. */
export function toBookingPageAvailabilityConsumer(
  input: BookingAvailabilityConsumerInput,
): BookingPageAvailabilityConsumerContract {
  const ready = presentation(input);
  return { getPresentation: () => ready };
}
