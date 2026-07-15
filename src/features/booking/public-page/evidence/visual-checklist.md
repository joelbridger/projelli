# Public booking page visual evidence

Captured from the real React components in a temporary local Vite harness at 1440 px wide on 2026-07-15.

- `settings-preview.png`: hosted-link rail, copy/preview controls, landing and branding fields, and the embedded public preview.
- `hosted-available.png`: brand header, advisor panel, meeting copy, injected dates and slots, privacy reassurance, and disclosure footer.
- `hosted-information.png`: the information-only form after selecting an injected slot, with no booking action, hold, or send path.
- `hosted-unavailable.png`: safe unavailable response with no invented dates, slots, calendar names, or busy details.

## Sonnet vision checklist — round 2

- PASS — brand/header.
- PASS — advisor panel and local-photo initials fallback.
- PASS — hosted link/copy/preview rail, including the local-preview caveat.
- PASS — date and slot UI matches the frozen prototype's structure and visual language.
- PASS — confirmation-information form has no booking/submit action and says no time is held or information sent.
- PASS — disclosure and privacy footer.
- PASS — unavailable safety with no invented availability.
- PASS — no busy-detail leakage; private calendar details are explicitly not shown.
- PASS — overall polished light-theme prototype parity.

Final Sonnet verdict after the meeting-details and privacy-copy fixes: `CLEAN`. No material visual issues remained. The review explicitly accepted that Wave 2 owns availability, meeting types, calendars, and all writes.
