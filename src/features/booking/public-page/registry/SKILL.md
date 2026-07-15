---
name: booking-page-registry
description: Register and validate a public booking page descriptor when adding a booking-page presentation type under src/features/booking/public-page.
---

# Booking page registry

Append one immutable descriptor to `bookingPageRegistry`. Give it a unique `id`, a namespaced `labelKey`, a concise `description`, a public-page renderer, a settings renderer, and the hosted-link adapter.

Run the colocated registry test after every change. Do not replace or repurpose an existing id; descriptor ids can appear in hosted links.

Wave 2 `booking-availability` owns the availability model, including windows, meeting types, calendar reads, and free/busy decisions. A descriptor may consume only `BookingPageAvailabilityConsumer`, the narrow display-ready interface in `../availability.ts`. Do not add persistence, booking writes, confirmations, holds, egress declarations, or calendar/provider calls here.

## Reviewer checks

- Confirm the change only appends a new descriptor and does not alter or repurpose an existing id.
- Confirm machine validation rejects duplicate ids, missing text, non-object entries, and a wrong runtime type for every descriptor field.
- Load both registered renderers and resolve the hosted-link adapter in the colocated test.
- Confirm the renderer receives only `BookingPageAvailabilityConsumer`; reject any availability schema, persistence, calendar access, hold, booking write, confirmation, or egress dependency.
- Confirm image sources remain local-only, the feature stays dark by default, and the copy control cannot report success without a real copy callback.
- Run the colocated tests, test typecheck, flag expiry test, i18n shard inventory test, and UI handle guard before accepting a change.
