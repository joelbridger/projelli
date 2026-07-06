# Worker brief — QA-91: Notice Card never joins the meeting (WebView2 creation crash) — DEMO STEP 5 BLOCKER

You are **cc-lantern-qa91**, worktree **~/lp-qa91**, branch **lp/qa91-noticecard-join** (off current lantern-plus tip). Rust/Tauri-heavy lane, demo-critical. You do NOT merge; the coordinator merges. SCOPED tests only (tsc + your test files; cargo for your Rust area) — never the full suite (WORKER-DISCIPLINE.md).

## The bug (proven live, twice, on real Windows with a real 2-person Teams meeting)
Evidence: `coordination/qa-campaign/evidence/winsmoke-qa90-91/SCORECARD.md` (branch lp/winsmoke-evidence, commit 31edaefd) — read it. Summary: recording + transcript/notes work fine, but the Notice Card companion guest NEVER joins the meeting. The host's lobby shows ZERO admit requests (polled 9× over 135s) — it fails before ever asking Teams to let it in. Recorder widget eventually shows "Notice card couldn't join. Say the notice aloud." (once after ~9 min, once after 4:35 — non-deterministic timing, same root).

**Crash signature already in the backend logs:** `failed to create webview: WebView2 error: WindowsError(HRESULT(0x8007139F), ...)` — 0x8007139F = ERROR_INVALID_STATE. The failure is at (or before) creating the hidden WebView2 window that drives the guest join.

## Mechanism map (from a completed code investigation — trust but verify)
Full log: `/tmp/claude-1000/-home-jameson-lantern-plus/cbf813e9-0636-4dab-94c6-c1621a39686c/scratchpad/codex-noticecard.log` (read the last ~7KB). Key pieces: `src-tauri/src/commands/notice_card/mod.rs` (companion window creation), `src/features/meetings/noticeCard/supervisor.ts` (join lifecycle, 120s timeout at :87), `adapters/teamsAdapter.ts` (selectors), `canvasCard.ts` (canvas camera feed), `meetingStore.ts:998-1052` (start sequencing).

## Likely root-cause area (verify, don't assume)
HRESULT 0x8007139F on WebView2 creation in a Tauri app typically means the second webview's environment/options conflict with the already-running WebView2 environment in the same process (e.g. different user-data-folder or environment options, or a UDF lock). Note the app itself sets custom browser args (`WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` forwarding fix in src-tauri/src/lib.rs from lp/azure-cdp-fix) — a mismatch between the main window's environment and the notice-card window's requested environment is a prime suspect. Investigate how the notice-card window is created vs the main window's environment settings.

## Method
1. Root-cause first: trace the exact creation call and why it returns INVALID_STATE. Write the failure down precisely before fixing.
2. TDD where the seam allows (Rust unit tests for the window-creation config; TS tests for supervisor error handling). A robust fix, not a retry-band-aid — though ALSO make the failure honest and fast: if the card genuinely cannot join, the recorder widget should say so quickly (not after 9 minutes) and prompt "say the notice aloud" — that fallback copy exists and is good.
3. You CANNOT fully verify a real Teams join from this server. Get the code fix + tests solid; the coordinator will schedule a real 2-person Legion re-test after merge. If you need a live check of window creation only (not a real meeting), say so in your report — the coordinator can arrange a Legion slot.
4. No `matter_id`/`Matter` renames. No cloud transcription. Scoped diff.

## Done criteria (HARD)
1. Root cause written in plain language in your summary, with file:line.
2. Tests red→green with real output; `cargo test` for your area green; `npx tsc --noEmit` green if TS touched.
3. Committed AND pushed (`git push -u origin lp/qa91-noticecard-join`; `--no-verify` authorized).
4. THEN print exactly: `WORKER-DONE: lp/qa91-noticecard-join` + 5-line summary.
