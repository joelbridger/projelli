# Lane L6 — MEETINGS (worktree /home/jameson/lp-ux-meetings, branch lp/ux-meetings)

Audit file: `meetings.md` (25 items). You are on Opus because this lane touches the SEND flow — the review gate is correctness-critical. Implement all HIGH+MED per common rules. Notes:

- Items 1+2+3+11 are one coherent rebuild: Send leaves the tab row (three content tabs remain), becomes a header `Send` action opening ONE merged send surface (drawer or inline) with one primary `Review send`; the person-first recipient matrix serves both calendar and manual paths; full To/Subject/Body/Attachment details appear ONLY in the review dialog.
- **TDD REQUIRED for the send merge:** write failing tests FIRST for the invariants, then refactor: (a) send impossible without email account + selected items + reviewed meeting; (b) Local-only mode blocks send; (c) the review dialog is unskippable; (d) recipient plan changes persist. The existing gating logic in MeetingArtifactSendPanel.tsx (~line 92) must survive verbatim in behavior.
- Item 12 exact privacy copy: `Review first. Sends by your email. Lantern never receives files.` — TrustNote at the action point (protected, do not drop).
- Items 5+6 (notice trail): verified/resolved = one slim row + Details; unverified/strict warning stays EXPANDED (protected). Item 9 (consent dialog → 3-row checklist): checkbox + spoken script stay visible (protected).
- Item 10 (calmer record pill): red dot + timer + `Local` chip + Stop always visible; Notice Card status only when abnormal.
- Item 7: `Mark reviewed` the only visible header button; Rename/Downloads/Exports/Delete audio into `...` (destructive confirm stays).
- Item 16 + F5: no mic tile per rail row; empty rail never doubles the pane's empty state.
