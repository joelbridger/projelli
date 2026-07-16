import { useEffect, useState } from 'react';
import { useFlag } from '@/platform/flags';
import {
  useBookingAvailabilityStore,
  useCalendarCapabilityStore,
  useCalendarEventStore,
  type BookingAvailabilityStore,
  type BookingPageAvailabilityConsumerContract,
  type CalendarCapabilityStore,
  type CalendarEventStore,
  type CalendarRange,
} from '@/features/calendar';
import { BookingPublicPage } from './BookingPublicPage';
import {
  loadingCalendarBookingPageConsumer,
  toCalendarBookingPageAvailabilityConsumer,
  unavailableCalendarBookingPageConsumer,
} from './calendarBookingAvailability';
import type { BookingPageBranding } from './types';

export interface CalendarBookingPublicPageProps {
  readonly branding: BookingPageBranding;
  readonly range: CalendarRange;
  readonly nowUtc?: string | undefined;
  readonly locale?: string | undefined;
}

/**
 * Flagged parent must mount this component. Its calendar hooks only run once
 * the outer calendar flag is on, and its child receives the injected consumer.
 */
export function CalendarBookingPublicPage({ branding, locale, nowUtc, range }: CalendarBookingPublicPageProps) {
  const eventStore = useCalendarEventStore();
  const capabilityStore = useCalendarCapabilityStore();
  const availabilityStore = useBookingAvailabilityStore();
  return (
    <CalendarBookingPublicPageLoader
      availabilityStore={availabilityStore}
      branding={branding}
      capabilityStore={capabilityStore}
      eventStore={eventStore}
      locale={locale}
      nowUtc={nowUtc}
      range={range}
    />
  );
}

interface CalendarBookingPublicPageLoaderProps extends CalendarBookingPublicPageProps {
  readonly availabilityStore: BookingAvailabilityStore;
  readonly capabilityStore: CalendarCapabilityStore;
  readonly eventStore: CalendarEventStore;
}

function CalendarBookingPublicPageLoader({
  availabilityStore,
  branding,
  capabilityStore,
  eventStore,
  locale,
  nowUtc,
  range,
}: CalendarBookingPublicPageLoaderProps) {
  const [consumer, setConsumer] = useState<BookingPageAvailabilityConsumerContract>(loadingCalendarBookingPageConsumer);

  useEffect(() => {
    let disposed = false;
    setConsumer(loadingCalendarBookingPageConsumer());

    void Promise.all([
      capabilityStore.get(),
      availabilityStore.get(),
      eventStore.listOccurrences(range),
    ]).then(([capability, availability, occurrences]) => {
      if (disposed) return;
      setConsumer(toCalendarBookingPageAvailabilityConsumer({
        availability,
        capability,
        occurrences,
        range,
        ...(locale === undefined ? {} : { locale }),
        ...(nowUtc === undefined ? {} : { nowUtc }),
      }));
    }).catch(() => {
      if (!disposed) setConsumer(unavailableCalendarBookingPageConsumer());
    });

    return () => {
      disposed = true;
    };
  }, [availabilityStore, capabilityStore, eventStore, locale, nowUtc, range]);

  return <BookingPublicPage availability={consumer} branding={branding} />;
}

/**
 * The dark-path boundary: no calendar hook, adapter, request, or page mount is
 * reached until the calendar integration itself is enabled.
 */
export function FlaggedCalendarBookingPublicPage(props: CalendarBookingPublicPageProps) {
  const enabled = useFlag('booking-public-calendar');
  if (!enabled) return null;
  return <CalendarBookingPublicPage {...props} />;
}
