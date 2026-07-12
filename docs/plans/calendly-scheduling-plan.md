# Calendly-style Scheduling — Implementation Plan (Option A, approved 2026-07-09)

**Status:** APPROVED by Jameson 2026-07-09. Architecture = **Option A (privacy-preserving)**.
**Branch:** `feat/calendly-scheduling` (worktree `~/lp-calendly`, off `lp/ux-simplify-v1`).
**Lead:** Fable (architecture + review). Build: Codex lanes under review.
**North star:** an *elegant, robust* booking experience inside Advisor Prep Hero whose privacy story beats Jump — "even our scheduling never exposes your clients."

---

## The architecture in one paragraph
The advisor's desktop app owns the truth (calendar, availability rules). It publishes to our **firm backend** (`api.lanternplatform.app`) ONLY a *booking-safe projection*: the advisor's public slug + display name, their bookable windows (working hours minus buffers), and a rolling **busy/free snapshot** (opaque blocks — no titles, no attendees, no client data). Clients visit `book.advisorprephero.com/<slug>`, see open slots computed from that snapshot, and submit a request. The desktop app polls/receives the request, **confirms it locally, writes the real calendar event on both providers, creates the video link, and sends the confirmation.** The server never holds a calendar token and never sees a client file. If the advisor's app is asleep, the request queues as "pending" and confirms when the app next wakes (with an auto-expire + "we'll confirm shortly" client message).

## What already exists (verified by scout, file paths)
- Calendar READ (Outlook/Google/ICS): `src-tauri/src/commands/calendar/{commands.rs,graph_source.rs,google_source.rs,store.rs}`; times normalized to UTC (`model.rs:38`).
- Email SEND: M365 `Mail.Send` + Gmail send scopes already granted (`mail/oauth.rs`, `mail/gmail/oauth.rs`); `MeetingSendPanel` send infra.
- Firm backend with E2EE relay + SSO: `backend/src/routes/sso.ts`, config `src/platform/firm/firmConfig.ts` → `api.lanternplatform.app`.
- Advisor profile (name/avatar/firm): `src/platform/profile/profileStore.ts`.

## What must be built (net-new)
1. **Calendar WRITE** — new Tauri commands `calendar_create_event` / `calendar_update_event` / `calendar_delete_event` + Graph/Google write clients. (Scout: no write path exists today.)
2. **OAuth scope upgrade** — Microsoft `Calendars.ReadWrite`, Google `calendar.events`. **One-time reconnect** for existing users (their saved token is read-only). Update `calendar/oauth.rs`, the read-only UI copy in `CalendarConnect.tsx`, and tests.
3. **Meeting-link creation** — create Teams/Zoom/Meet links (Graph `onlineMeeting`, Google `conferenceData`). Zoom needs its own OAuth app (later; Teams/Meet via the calendar providers first).
4. **Booking domain (new):** `AvailabilityRule` (working hours, meeting types, durations, buffers, min-notice, max-horizon), `BookingSlug`, `BusyFreeSnapshot`, `BookingRequest` (pending/confirmed/declined/expired). Desktop store + server tables. Timezone: advisor tz is new (profile lacks it today — add `advisorTimezone`).
5. **Server booking service** (firm backend): public read (slug → windows + free slots), write (submit request), advisor-authenticated sync (push snapshot, pull requests, post confirmations). Stores ONLY booking-safe data — a hard invariant, tested.
6. **Public booking page** (`book.advisorprephero.com/<slug>`): slot picker, timezone-aware, reschedule/cancel via signed links. Static + light backend.
7. **Reminders:** email (templates with `{client}`, `{date}`, `{reschedule_link}`) via existing send infra; SMS is a later add (needs a texting vendor).

## Phased build (each phase is demo-able)
- **Phase 1 — Availability + booking page skeleton.** Booking domain models (TDD), advisor sets working hours / meeting types / buffers, gets a shareable slug link, the public page renders open slots from a manually-pushed snapshot. *Milestone: "we have a booking link."*
- **Phase 2 — Real booking round-trip.** Client submits → desktop confirms → creates events both sides + video link → confirmation email with reschedule/cancel. Busy/free snapshot auto-syncs. *Milestone: an actual booking works end to end.*
- **Phase 3 — Reminders + polish.** Email reminders, multiple meeting types, double-booking guards, decline flow, the "app asleep" pending UX. SMS deferred.
- **Phase 4 — Hardening + privacy proof.** A test that asserts the server payload NEVER contains client-identifying data; timezone edge cases (DST); reschedule/cancel security (signed, single-use); load on the public page.

## Invariants (never break)
- The server payload is booking-safe ONLY (slug, windows, opaque busy/free, request contact) — a machine-checked test guards this. This is the whole privacy pitch.
- No calendar token ever leaves the desktop.
- Reschedule/cancel links are signed + single-use.
- Light theme; adopt the rail/header patterns from the UI overhaul.

## Deploy note
The public booking page + server booking service is a **backend deploy** to the firm infrastructure — that is a commercial deploy and needs Jameson's explicit go before it goes live. Building/staging is autonomous.

## Open tactical decisions (Fable decides unless flagged)
- Booking page host subdomain (`book.advisorprephero.com` proposed).
- "App asleep" confirmation UX: pending-with-auto-confirm (chosen) vs require-app-awake.
- Zoom support timing (defer to Phase 3+; Teams/Meet first).
