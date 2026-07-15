---
name: booking-page-registry
description: Register and validate a public booking page descriptor when adding a booking-page presentation type under src/features/booking/public-page.
---

# Booking page registry

Append one immutable descriptor to `bookingPageRegistry`. Give it a unique `id`, a namespaced `labelKey`, a concise `description`, a public-page renderer, a settings renderer, and the hosted-link adapter.

Run the colocated registry test after every change. Do not replace or repurpose an existing id; descriptor ids can appear in hosted links.

Wave 2 `booking-availability` owns the availability model, including windows, meeting types, calendar reads, and free/busy decisions. A descriptor may consume only `BookingPageAvailabilityConsumer`, the narrow display-ready interface in `../availability.ts`. Do not add persistence, booking writes, confirmations, holds, egress declarations, or calendar/provider calls here.
