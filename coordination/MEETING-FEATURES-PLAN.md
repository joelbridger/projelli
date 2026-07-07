# Meeting features build plan (from Jameson 2026-07-07; Codex builds all)

Source brainstorm + file anchors: `coordination/reports/meetings-features-brainstorm.md` (READ FIRST each round). Locked constraints: local-first, per-client isolation, recording-notice requirement, no cloud transcription, matter facade untouched, light theme. Each round = own branch off tip → Codex build (TDD, ui-system guards) → coordinator gate (npm run gate) → merge → gallery.

**Order (brainstorm-recommended, dependency-driven):**
- **MF0 — Calendar link foundation.** Save the selected calendar event into the meeting's metadata at record-start (the gap the brainstorm names). Prereq for MF1 recipient defaults and MF3 matching. Small. INDEPENDENT — build now.
- **MF1 — Recipient chooser.** After a meeting, pick per-artifact recipients (audio/transcript/summary/notes each to chosen people); recipients resolved from the client's contacts + free entry; stored on the meeting. Local, medium. INDEPENDENT — build now.
- **MF2 — Reviewed send.** Send the chosen artifacts to recipients via the email connector, ADVISOR-REVIEWED first (a compose/confirm step showing exactly what leaves + to whom + a durable send log + audit). True unattended auto-send is a later toggle once the log/retry/privacy-copy are solid. Depends on MF1. Medium.
- **MF3 — Calendar auto-join/record scheduler.** Sync Outlook/M365 + Google calendars, detect meetings with Teams/Zoom/Meet join links, schedule auto-join + record with the notice card, honoring consent + back-to-back/declined/no-link edges. Depends on MF0 (metadata) + reliable notice card. Large, highest risk — build LAST, ship a narrow first slice.

Coordinator note: MF2/MF3 send or auto-join client data — treat as customer-facing; MF2 stays review-gated until Jameson explicitly OKs unattended; MF3 first slice is opt-in per calendar with a visible "will auto-join" list before anything joins.
