# Scheduling — UX / UI Design Plan

*Fable's design plan for the Calendly-style feature. Every surface is built from the SAME design system we standardized across the app this week — no new visual language. Two audiences: the **advisor** (inside the app) and the **client** (the public booking page). Principle throughout: one clear action per screen; advanced controls stay folded until needed; the privacy story is visible but quiet.*

---

## Design-system alignment (what we reuse, verbatim)
- **Layout:** `SurfaceHeader` (accent icon + full-size title on its own row — identical height to Client Map / Ask / Workflows), `RailShell` + the unified rail header, `--kp-rail-width` for any rail.
- **Components:** `Card`, `Button`/`IconButton`, `SegmentedToggle` (e.g. meeting-type switch), `SlidePanel` (edit a meeting type), `EmptyState`, `Eyebrow`, `Chip`/`Badge`, `SearchField`, `TrustNote` (the privacy line), `QuietStatus` (confirmed = quiet, pending = loud), vertical `⋮` menus, `SearchField`.
- **Style:** light theme only, red accent for primary/selection, calm flat rows over boxes-in-boxes, sentence-case copy, no ellipses. Booking-time math is correctness-critical (built test-first) — the UI just surfaces it.

---

## 🟦 THE ONE DECISION I NEED — where Scheduling lives in the app
The nav is a deliberate 3-tab IA (Client Map · Ask · Workflows) — a board decision to stay simple and AI-first. Scheduling is advisor-level (not per-client) and not AI, so I do **not** want to dilute the three tabs. My recommendation and the options:

- **Option 1 (my recommendation): a dedicated "Scheduling" surface reached from a small calendar entry in the top bar** (next to the trust pill / gear), not a 4th rail tab. Keeps the 3-tab IA pure; gives Scheduling a real home for both setup and the bookings list. One click, out of the way until wanted.
- **Option 2: fold into the account/profile menu** (bottom-left) — fine for setup, but the *daily* "who booked me / confirm this request" part deserves more presence than a settings tuck-away.
- **Option 3: a 4th rail tab "Scheduling."** Most discoverable, but breaks the deliberate three-tab simplicity. I'd avoid unless you want scheduling to be a headline, everyday surface.

*My pick: Option 1. Say the word and the whole plan below hangs off it.*

---

## ADVISOR SIDE

### A. Scheduling home (the surface)
`SurfaceHeader`: calendar icon + "Scheduling". Below, two calm zones:
1. **Your booking link** — a single prominent `Card`: the link (`book.advisorprephero.com/jameson`), a **Copy** button, **Preview** (opens the client page), **Share**. One `TrustNote` under it: *"Clients only ever see your open times — never your calendar details or who else you meet."* (This is the privacy pitch, stated once, quietly.)
2. **Upcoming & requests** — a flat list of bookings. Each row: client name · meeting type · date/time · status.
   - Confirmed → `QuietStatus` (quiet check, no shouting).
   - **Pending (needs confirmation)** → a loud amber chip + inline **Confirm / Decline / Suggest another time** (this is the "app was asleep" case — see UX note below).
   - `EmptyState`: *"Share your link to start taking bookings."* + Copy link.

### B. Availability setup (a `SlidePanel` or a settings section, reached from the header `⋮` or a "Set up availability" button)
- **Working hours** — a clean weekly list: each weekday a toggle (available?) + a time range (from–to). Add a second range for split days. Minimal, no grid overkill.
- **Meeting types** — a flat list; each row = name · duration · a `⋮` to edit/delete. "Add meeting type" opens a small `SlidePanel`: name, duration, buffer before/after, video platform (Teams/Meet). One primary meeting type by default so setup is instant.
- **Advanced (folded by default, per our "quiet until needed" rule):** minimum notice, how far out clients can book, which connected calendar to check, your timezone.
- One-time note if scopes need upgrading: a calm `TrustNote` — *"To create booked events, reconnect your calendar once with write access."*

### C. A booking request (the pending state, done right)
When the app was asleep and a client booked, the request lands as **pending**. The advisor sees an actionable row (and a small count on the Scheduling entry). Confirm → writes the event both sides + video link + sends the client confirmation. Decline/suggest → the client gets a polite note. This pending model is what lets us keep the privacy promise (no server-held calendar token) without a broken client experience.

### D. Reschedule / cancel (advisor view)
Client-initiated reschedule/cancel arrives as a quiet notification; the booking row updates its time/status. No modal storms.

---

## CLIENT SIDE — the public booking page
Standalone (no app chrome), but unmistakably ours: APH logo, red accent, the same type system, light. **Mobile-first** (clients book on phones).

1. **Landing:** advisor photo + name + firm, a one-line intro. If multiple meeting types → a clean `SegmentedToggle` or card picker.
2. **Pick a time:** a simple month/week calendar + a slot list for the chosen day. **Timezone auto-detected**, with a visible changer ("Times shown in [their tz]"). Only open slots show — computed from the opaque busy/free snapshot, so nothing about the advisor's other meetings leaks.
3. **Details:** short form — name, email, optional note. Big clear **Confirm** button.
4. **Confirmed screen:** *"You're booked — [type] with [advisor], [date/time]. A calendar invite is on its way."* + reschedule/cancel links.
5. **Reschedule / cancel:** reached from the signed single-use link in the email; same clean picker.
6. **Edge states designed, not afterthoughts:** no availability ("[Advisor] has no open times this week — [next available]"), just-taken slot ("that time was just booked — pick another"), and the app-asleep case ("Request received — you'll get a confirmation shortly," never a dead end).

---

## UX principles baked in
- **Minimal but complete:** everything Jump's scheduler does, but advanced knobs folded; one primary action per screen.
- **Privacy as a feature, shown quietly:** the "clients only see open times" `TrustNote` on setup + a small line on the public page footer. It's our edge — surface it, don't shout it.
- **Graceful async:** the pending/confirm model is designed into the UX from the start, not bolted on.
- **Consistency:** an advisor who knows Client Map/Ask/Workflows instantly knows this — same header, rails, menus, chips, empty states.
- **Accessibility:** keyboard-navigable slot picker, visible focus, screen-reader labels on every icon action; the public page meets contrast in light.

## Build note
This UX plan feeds the phased build in `calendly-scheduling-plan.md`. Phase 1 (availability model + engine) is building now; the surfaces above land in Phases 1–3 as the domain + server come online. I'll produce clickable before-build mockups of the Scheduling home + the public page for your sign-off before wiring, the same way we've reviewed everything else.
