# Sonnet vision checklist — booking-public-page

Reviewer: Claude Sonnet, high effort (batch evidence lane)

Reference: `/home/jameson/lantern/design/alt-familiar/prototypes/alt-familiar-hifi-v2/index.html`, `publicBookingPage()` (public-facing page) and `bookingSettings()` (advisor settings/preview rail).

Real app: `BookingPublicPage` / `FlaggedBookingPublicPage` at `src/features/booking/public-page/BookingPublicPage.tsx`. Availability is intentionally stubbed — `booking-availability` (Wave 2) owns the real availability model per the ruled note in `V1-FEATURE-MATRIX.md`; a stubbed availability area is expected here, not a delta.

## Navigation gap — honest finding

`booking-public-page` has **no in-app navigation entry point yet**. Grepping the whole `src/` tree for consumers of `BookingPageSettings`, `BookingPublicPage`, `getBookingPageDescriptor`, or `bookingPageRegistry` outside the feature's own folder returns nothing: no `appSurfaceRegistry`, `settingsModuleRegistry`, or route mounts it. This matches the matrix's own note that the hosted-service-module path is still OPEN. The lane's own prior evidence (`src/features/booking/public-page/evidence/visual-checklist.md`) was captured the same way — from "a temporary local Vite harness," not the wired app — because there is nothing to navigate to yet.

To get an honest look at the real component in the real running app (not a reproduction), this batch evidence dynamically imports the real `FlaggedBookingPublicPage` module from the live dev server's module graph and mounts it into a full-viewport overlay via `ReactDOM.createRoot`, using the exact same stub data (`createBookingPageAvailabilityStub`) and `defaultBookingPageBranding` the component's own test file uses. This is real product code, rendered by the real running app — just without a nav entry to click through, because none exists yet.

Screenshot(s): `06-booking-public-page-on.png` (pick-time step), `06b-booking-public-page-confirmation.png` (confirmation-information step after picking a slot).

## Frozen prototype spec (public booking page)

- Brand header: mark + firm name + tagline + "← Back to Lantern"
- Left aside: "Client booking page" chip, avatar initials, "Meet with [Advisor]", meeting type/platform/timezone, "What we can cover" copy, firm disclosure/privacy footer
- Right: step label "1 · Pick a day & time", date strip, time slot grid, privacy reassurance copy ("Busy blocks ... already removed. Private calendar details are never shown.")
- Confirmation step: "Time held for 10 minutes" chip, name/email/discussion fields, notice that the meeting will be added to the advisor's calendar and both parties notified, Back/Confirm buttons

## Real-app structure

- Brand header (`booking-public-page-brand-header`): firm mark + name + landing copy — matches
- Advisor aside (`booking-public-page-advisor`): initials avatar, "Meet with [advisor]", meeting title/description, meeting details line — matches
- Picker (`booking-public-page-picker`): step label, date buttons, slot grid seeded from the stub, privacy reassurance line — matches structurally
- Confirmation-information (`booking-public-page-confirmation-information`): name/email/discussion fields + explicit safety notice that **no time is held and no information is sent** — this is a deliberately *stronger* safety stance than the prototype's confirmation step, which implies an actual hold and calendar write ("Time held for 10 minutes" / "will be added to Sarah's calendar"). The real component is presentation-only by design (per its own doc comment: "Selecting a source-provided slot reveals information fields, but does not hold a time, write a booking, or submit").
- Disclosure footer (`booking-public-page-disclosure`) — matches

## Checklist

| Check | Verdict | Evidence |
|---|---|---|
| Brand header matches (Northstar Advisory, mark, tagline) | PASS | `06-booking-public-page-on.png` — "N" mark, "Northstar Advisory", "Thoughtful planning for the life you are building." |
| Advisor panel matches (Sarah Morgan, initials fallback, meeting details) | PASS | "SM" avatar, "Meet with Sarah Morgan", "CFP®", "45-minute planning meeting · Microsoft Teams · Mountain Time" |
| Date/slot picker structure matches prototype's date-strip + slot-grid | PASS | "Tue 21"/"Wed 22" date buttons, "10:30 AM"/"1:30 PM" slot buttons, styling matches the prototype's card/button language |
| Privacy reassurance copy present | PASS | "Private calendar details are never shown on this page." |
| Confirmation-information step present after picking a slot | PASS | `06b-booking-public-page-confirmation.png` — "Tell us a little about yourself", name/email/discussion fields, explicit "This page does not book meetings yet" safety notice |
| No in-app navigation entry point exists yet (booking-availability/hosted-service-module still OPEN per matrix) | **Honest gap, not scored as a visual PASS/DELTA** | see "Navigation gap" above; confirmed by grep — no consumer of `bookingPageRegistry`/`FlaggedBookingPublicPage` outside its own folder |
| Confirmation copy is more conservative than the prototype (no hold/no calendar write vs. prototype's "time held"/"added to calendar") | **Expected DELTA** — deliberate, by design, per the component's own doc comment and the ruled availability-ownership split | `06b-booking-public-page-confirmation.png` |

OVERALL: **PASS** for visual/structural parity of the built component against the frozen spec, with one **honest, material gap**: there is no way to reach this surface from inside the running app today (no settings entry, no route). The evidence above proves the component itself is correct and stubbed-availability-safe; it does not prove an advisor can find it without engineering help. This matches the matrix's own "OPEN — hosted and native support paths are not fully specified" note (note 7) — not a surprise finding, but worth stating plainly rather than rounding to a clean PASS.
