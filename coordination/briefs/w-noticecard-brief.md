# Build brief — the NOTICE CARD v1+v2 (local notice participant) — Jameson-approved flagship

**Lane:** cc-lantern-noticecard · dir `~/lp-noticecard` (own worktree, branch `lp/notice-card`). **Model:** Opus 4.8 · high (novel cross-system feature; correctness-critical lifecycle — coordinator-stated reason).
**Read FIRST, in order:** `docs/strategy/2026-07-04-notice-participant-design.md` (THE design — golden path, canvas-camera insight, build ladder, risks; you are building v1+v2 of its ladder) · `docs/strategy/2026-07-04-recording-notice-brainstorm.md` (context) · the just-merged Notice Kit surfaces (@0c6a8488): ConsentDialog's notice step, consentLedger, the notice policy dial — you EXTEND these, never fork them.
**Rules:** NO-SHORTCUTS. TDD. Codex self-review foreground/watched, ≥2 clean-adjacent rounds. i18n en/de/es, i18n:check 0, en-json snapshot per its documented regen procedure. PULL + reconcile before handoff. Unique dev-server port. No interactive menus — `COORDINATOR:` plain text.

## Lane boundary (two fix lanes are finishing)
qafix5 owns DocxEditor/save path; qafix6 owns keychain/startup/dialog plumbing. Not your files. You own: new `src/features/meetings/noticeCard/` (or platform equivalent — your call per ARCHITECTURE.md layers), the companion-webview Rust command(s), the calendar join-URL model extension, ConsentDialog's card toggle (additive), ledger event types (additive), settings additions.

## Scope — v1+v2 from the design ladder, plus the two quick wins

### v1 — the joining participant
1. **Calendar join-URL field:** extend calendar sync (CalendarEventDto + the Rust/Graph/Google fetch) to carry the event's online-meeting join URL + platform detection (Teams/Zoom/Meet/other). Read-scope only.
2. **Consent-dialog integration:** when a calendar event overlapping NOW (±grace) has a join URL, the dialog shows "Add the Notice Card to this meeting? [meeting title — platform]" — pre-checked per firm setting; absent/unknown meeting → toggle hidden (manual URL paste as a small secondary affordance). Never blocks recording.
3. **Companion webview join (Teams + Zoom adapters):** an isolated Tauri window (NO IPC bridge to app internals — meeting pages are untrusted) opens the join URL, sets display name (firm-configurable template, default "⏺ Recording Notice — {advisor first name}", per-platform length guards), joins muted, detects admitted/lobby/denied states. Meet: detect and show the honest "Meet: say the notice aloud" fallback (no adapter in this build).
4. **Lifecycle supervisor:** join on record-start; LEAVE on record-stop (hard guarantee — watchdog kills the window on meeting end no matter what); one auto-rejoin on unexpected disconnect; all transitions ledgered (`notice-card-joined/left/failed(reason)` + derived `notice-card-present-for-entire-recording`).
5. **Policy hook:** the Strict evidence rule accepts (configurably) verified-verbal-notice OR full-duration card presence; default either-satisfies, both recommended (per design).
6. **Pill/status:** small honest indicator ("Notice card in meeting ✓" / "Notice card couldn't join — say the notice aloud").

### v2 — the visual card
7. **Canvas camera:** in the companion webview, intercept getUserMedia to supply a canvas capture stream rendering the notice card (calm light theme, firm logo slot, 3 lines localized, live "Recording · M:SS" timer, "This card leaves when recording ends" line). Card content from the same firm-customizable notice settings the Kit added.

### Quick wins (small, same lane)
8. Ship the official "⏺ RECORDING in progress" **virtual background image** asset (in-app: a "Save recording background image…" action in the notice settings + docs line).
9. **Zoom guided native-record checklist item** in the consent dialog when platform=Zoom: "Also press Zoom's Record button — participants get Zoom's official notice" with a ledger self-attest checkbox.

## Testing reality (be honest about seams)
Unit/integration: adapters tested against recorded page-fixture DOM (join-form fill, admitted/denied detection) — the design names this pattern; supervisor state machine fully unit-tested (join/leave/rejoin/watchdog, fake clock); ledger + policy + dialog RTL tests; canvas card render test. LIVE join verification against real Teams/Zoom needs a bench pass — NOT yours: hand off with the unit story green and honest notes on what needs the live pass (I'll run it on the Legion, which also does the Meetings DONE run).

## Gate + handoff
tsc · typecheck:tests 0 · i18n 0 · full vitest · eslint-gate · Rust-touched ⇒ own CARGO_TARGET_DIR=$HOME/.cargo-target-lp-noticecard, timeout 1200, one cargo box-wide. Handoff: HEAD SHA · gate counts · adapter design notes + what the live bench pass must verify · screenshots of the dialog toggle + card render (browser build) · self-review rounds. Push (NOT self-merged), then exactly: `WORKER-DONE: lp/notice-card`
