/**
 * The public page consumes this deliberately small, display-ready contract.
 * Wave 2's booking-availability module owns the availability model and will
 * adapt its result to this interface. It must not be used for calendar reads,
 * holds, or booking creation.
 */
export interface BookingPageDateOption {
  id: string;
  label: string;
  accessibleLabel: string;
}

export interface BookingPageSlotOption {
  id: string;
  label: string;
}

export type BookingPageAvailabilityPresentation =
  | { state: 'loading' }
  | { state: 'unavailable'; message?: string | undefined }
  | {
      state: 'available';
      dates: readonly BookingPageDateOption[];
      slotsByDate: Readonly<Record<string, readonly BookingPageSlotOption[]>>;
    };

/** The narrow, injected consumer boundary for a public booking page. */
export interface BookingPageAvailabilityConsumer {
  getPresentation(): BookingPageAvailabilityPresentation;
}

/** A deterministic test/preview source. It stores nothing and makes no calls. */
export function createBookingPageAvailabilityStub(
  presentation: BookingPageAvailabilityPresentation,
): BookingPageAvailabilityConsumer {
  return {
    getPresentation: () => presentation,
  };
}
