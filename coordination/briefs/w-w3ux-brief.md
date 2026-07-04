# Review gate — Meetings tab through a SENIOR UX DESIGNER lens (fires after w3c surface lands)

**Lane:** cc-lantern-w3ux · worktree `~/lp-w3ux` (branch off the merged Meetings-tab tip)
**Model:** FABLE 5 · high (Jameson-authorized for judgment-heavy work; this is a design-quality gate, not volume). This lane REVIEWS and produces a findings doc + a scoped polish branch — it does not rebuild the feature.

## Mandate (Jameson, 2026-07-04)
"Review the entire Meetings tab through a senior UX designer lens so that it is extremely intuitive and integrates well with the rest of the app." The bar is: a financial advisor who has never seen it understands it in seconds, recording feels obviously safe and controllable, and nothing about it feels bolted-on.

## Method
1. **Experience it as a first-time user**, driven live (browser dev build for speed + the Legion for the real record flow via the coordinator). Walk the whole journey: discover the Meetings tab → start a recording (consent dialog, record pill) → stop → wait for notes → read notes + transcript → find it later (Meetings tab list + Activity entry) → the "needs review" queue → delete-audio-keep-transcript. Also the dictation "File as meeting note" path.
2. **Judge against three references:** (a) Jameson's locked decisions + prototype `docs/design/lantern-plus-prototypes/p6-client-meetings-tab.html`; (b) the app's EXISTING patterns (how Documents/Email/Client Map tabs look and behave — the Meetings tab must feel like a sibling, same spacing/typography/empty-state/loading idioms); (c) the approved reimagine design language (`~/kp-reimagine`, tag ui-reimagine-approved-2026-07-03) so this doesn't merge and then immediately clash with the pending holistic redesign.
3. **Evaluate specifically:** clarity of every label/button (no jargon; client/meeting never "matter"); the record pill as the whole recording UI (is state — idle/recording/elapsed/egress-dot/stop — always obvious?); consent legibility; what the empty Meetings tab teaches; loading/transcribing states (does the user know it's working and roughly how long?); error states (mic denied, transcription failed, disk full); keyboard/focus/contrast accessibility; light-theme correctness; mobile-width behavior isn't required (desktop app) but window-narrow shouldn't break.
4. **Produce `docs/design/2026-07-04-meetings-tab-ux-review.md`:** findings ranked (blocker / should-fix / polish), each with a concrete recommended change and a screenshot. Implement the blocker + should-fix items on branch `lp/wave3-meetings-ux` (scoped visual/copy/interaction polish — no engine changes); leave genuinely optional polish as documented backlog. Every finding must make the feature more intuitive or more integrated — not just different.

## Gates
tsc + full vitest + eslint-gate; extend the bench-mirror Meetings specs for any interaction you change; codex review of the polish diff. Push; do NOT merge (coordinator merges after review + a live Legion walkthrough with screenshots for Jameson). Last line exactly: `WORKER-DONE: lp/wave3-meetings-ux`
