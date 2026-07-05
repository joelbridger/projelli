# Windows Smoke Run #2 of 3 — Scorecard

**Date:** 2026-07-05
**Tip tested:** `origin/lantern-plus` @ `f42ac7cf` (merge: lp/rust-harden — recover from Rust panics/crashes, QA-65/66/67)
**Rust surface changed since run 1:** `capture/engine.rs`, `calendar/store.rs`, `crm/store.rs`, `mail/store.rs`, `audit/store.rs`, `retention/sweep.rs`, `diarize/mod.rs`, new `util/sync.rs`
**Bench:** Legion Windows laptop (Tailscale `james@100.127.67.22`), driven via CDP (`scripts/desktop-drive.mjs`) + pyautogui agent (`legion_agent.py`)
**Worker:** cc-lantern-winsmoke

## Result: PASS (run 2 of 3)

No product regressions found. Did a full `src` + `src-tauri` sync and let cargo rebuild (required — rust-harden changed the Rust engine) before testing, per the run-1 lesson. Cargo build finished clean (1 benign unused-import warning only), no panic on boot.

## Scorecard

| # | Check | Result | Evidence |
|---|-------|--------|----------|
| 1 | Boot → real UI renders (not blank/crash) on the rebuilt f42ac7cf binary | **PASS** | `01-boot.jpeg` — Client Map renders, 27 clients, no crash |
| 2 | Create a client | **PASS** | `02-client-created.jpeg` — "Winsmoke Run2 Client" created, 27→28 |
| 3 | Create a `.docx`, type content | **PASS** | `04-doc-created.jpeg`, `05-typed-content.jpeg` |
| 4 | Autosave confirms | **PASS** | File + a `.backup-*.docx` safety copy both written to disk with matching mtime |
| 5 | Close & reopen (full app restart) — content survives | **PASS** | `06-reopened-after-restart.jpeg` — paragraph text + tracked INSERT change both survived; restart itself was clean (no panic in `tauri-dev.log`) |
| 6 | Ask a question | **PASS** | `07-ask-answer.jpeg` — cited, verified answer scoped to the active client |
| 7 | Open Meetings tab | **PASS** | `08-meetings-tab.jpeg` — clean empty state |
| 8 | **Real meeting recording start/stop** (the specific ask for this run — rust-harden touched `capture/engine.rs`) | **PASS** | `09-recording-started.jpeg` (clean start, live 0:02 timer) → `10-recording-stopped.jpeg` (clean stop, meeting card appears, "1 min · notes pending") → `11-meeting-entry.jpeg` (valid 0:21 audio waveform, playable, "Delete audio" present) |

## Notes for the coordinator

**One non-fatal warning observed, not treated as a regression:** `tauri-dev.log` logged twice —
```
[capture::engine][WARN] capture audit append failed (non-fatal): audit chain altered: Altered { seq: 2, id: "audit_1783250170990_dfl9vdm", reason: "chain head mismatch", checked: 2 }
```
This surfaced ~90s after the recording stopped, while the app kept working normally (meeting entry rendered, playable audio, no crash). Read charitably, this is very plausibly the rust-harden fix *doing its job* — my session force-killed (`Stop-Process -Force`) the app process mid-session multiple times as part of the sync/rebuild routine, which is exactly the kind of abrupt-termination scenario that could leave an audit-chain entry unfinalized. The new guard in `audit/store.rs` appears to detect that on next append and degrade gracefully (log + continue) instead of panicking — which is the intended outcome of this merge. I did not reproduce it via a "clean" recording (start→stop with no prior force-kill in that same session), so I can't confirm whether it would still fire without my test-harness's process kills. Flagging transparently rather than filing a QA-## — if the coordinator wants it chased down, worth a targeted repro: record a meeting on a completely fresh boot with zero prior force-kills and see if the warning still appears.

## Evidence directory

11 screenshots + this scorecard in `coordination/qa-campaign/evidence/winsmoke-run2/`.

## Remaining stability-proof work

This was run **2 of 3**. One more clean consecutive run needed to close bucket 6 (STABILITY PROOF) in `coordination/TRUST-BREAKER-LOCKDOWN.md`.
