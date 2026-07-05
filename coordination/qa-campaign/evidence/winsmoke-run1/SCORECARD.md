# Windows Smoke Run #1 of 3 — Scorecard

**Date:** 2026-07-05
**Tip tested:** `origin/lantern-plus` @ `b1794baf` (6 trust-breaker fixes merged)
**Bench:** Legion Windows laptop (Tailscale `james@100.127.67.22`), driven via CDP (`scripts/desktop-drive.mjs`) + pyautogui agent (`legion_agent.py`)
**Worker:** cc-lantern-winsmoke

## Result: PASS (run 1 of 3)

No product regressions found. Two hiccups occurred during the run; both were traced to my own test methodology / bench staleness, not the app — see "Notes for the coordinator" below.

## Scorecard

| # | Check | Result | Evidence |
|---|-------|--------|----------|
| 1 | Boot → real UI renders (not blank/crash) | **PASS** | `01b-boot-clean.jpeg` — Client Map with 27 clients renders correctly |
| 2 | Create a client | **PASS** | `03-client-created.jpeg`, `04-client-selected.jpeg` — "Winsmoke Test Client" created, client count 26→27 |
| 3 | Create a `.docx`, type content | **PASS** | `13-doc-opened-clean.jpeg`, `14-typed-content.jpeg` — typed via agent (physical-coord click + paste), rendered correctly |
| 4 | Autosave confirms | **PASS** | `15-after-tab-save.jpeg` — "Saved · 10s ago"; file mtime on disk updated to match |
| 5 | Close & reopen doc — content survives | **PASS** | `17-reopened-after-restart.jpeg` — did a **full app restart** (strongest form of close/reopen); paragraph text + tracked INSERT change both survived byte-for-byte |
| 6 | Ask a question | **PASS** | `19-ask-answer.jpeg` — cited answer, "Verified against source", correctly scoped to the active client only |
| 7 | Open Meetings tab | **PASS** | `20-meetings-tab.jpeg` — clean "No meetings yet" empty state, no crash |
| 8 | **QA-71**: delete-audio warning when no transcript exists | **PASS (live-verified)** | `30-delete-audio-warning.jpeg` — recorded a real meeting, transcription genuinely unavailable ("voice engine isn't installed"), clicked Delete audio → dialog correctly reads: *"There is no transcript and no notes for this meeting yet. Deleting the audio now permanently removes the only copy of the meeting. This cannot be undone."* Cancelled to preserve the meeting as evidence. |
| 9 | Save-integrity edge case (survives full restart) | **PASS** | Same as #5 |
| 10 | Cross-client isolation (no bleed) | **PASS** | `31-winsmoke-meetings-recheck.jpeg` (Hollings' new meeting does NOT show under Winsmoke client) + `33-caldwell-docs2.jpeg` (Caldwell's Documents show only her own files, no `winsmoke-smoke-doc.docx`) + Ask scoped-to-client only found the 1 doc that actually belongs to that client |

## Notes for the coordinator (not product bugs, but worth knowing)

1. **Self-inflicted hiccup, now cleaned up:** early in the run I scp'd a throwaway `check-cdp.ps1` directly into `C:\keepance` (the Vite-watched source root) to debug a tunnel issue. This crashed the Vite dev-server file watcher (`EBUSY` error → `beforeDevCommand terminated with a non-zero status code`), which then made a freshly-created `.docx` panel unable to load ("Couldn't load this panel... couldn't be fetched") even though the file was safely on disk (confirmed via direct `Get-Item`). Removing the stray file and doing a clean app restart fully resolved it — reproducible only by contaminating the watched dir, not a real user path. No ticket filed.

2. **Bench hygiene finding — worth flagging:** the Legion's compiled Rust backend was stale relative to current `lantern-plus` source. `capture_start` (meeting recording) is defined and registered in the current `src-tauri` source but the *running binary* didn't have it ("Command capture_start not found") until I did a full sync (`src` + `src-tauri`) and let cargo rebuild. `legion-sync-launch.sh` only syncs `src/` by design (fast path for frontend-only changes, which is all the recent trust-breaker merges touched) — that's correct for those merges, but it means the Rust side can silently drift stale across sessions if nobody does a full sync periodically. Recommend: future workers doing anything meeting/audio/Rust-related on this bench should do a full sync first, or the coordinator should schedule an occasional full resync regardless of whether the merged diff touched `src-tauri`.

## Evidence directory

All 36 screenshots numbered in chronological order in this folder (`coordination/qa-campaign/evidence/winsmoke-run1/`). Key ones referenced above.

## Remaining stability-proof work

This was run **1 of 3**. Two more clean consecutive runs are needed to close bucket 6 (STABILITY PROOF) in `coordination/TRUST-BREAKER-LOCKDOWN.md`.
