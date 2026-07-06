# Worker brief — QA-91b: Notice Card doesn't recognize the current Teams join page (selector drift)

You are **cc-lantern-qa91b**, worktree **~/lp-qa91b**, branch **lp/qa91b-teams-adapter** (off tip 9067bb7f). Demo-critical. You do NOT merge. SCOPED tests only; push with --no-verify authorized.

## State of the bug (one layer peeled per live test — read both)
- Layer 1 FIXED & VERIFIED: the WebView2 window-creation crash (0x8007139F) is gone — merged as lp/qa91-noticecard-join (shared browser args, src-tauri/src/webview_env.rs).
- Layer 2 = YOUR TARGET: on a REAL Teams meeting the companion guest now opens its window but fails with the injected script's **"page-unrecognized"** soft-fail after ~29s, 3/3 consistent tries, never reaching the lobby. Evidence: branch lp/legionverify-evidence commit d000de06 (read its QA-91 retest report). The recognizer timing matches `src/features/meetings/noticeCard/injectionScript.ts:23` (~28s unrecognized soft-fail); the page adapter is `src/features/meetings/noticeCard/adapters/teamsAdapter.ts:16` — its selectors (name field, mute button, join button, lobby, admitted state) no longer match today's Teams anonymous-join web UI.

## Method — ground the fix in the REAL page, not guesswork
1. Get the actual current DOM: using the server's always-on Chrome (chrome-cdp CLI — see the chrome-drive skill): create a real meeting via "Meet now" on teams.live.com in one session (it holds a signed-in account); open the meeting join URL in a SECOND, separate anonymous session; on that join page run snapshot/eval to capture the real structure of: the guest name input, mute/camera toggles, the Join button, the lobby waiting state, and (after you admit the guest from the host session) the admitted state. Save the relevant DOM excerpts to your worktree as evidence.
2. Update teamsAdapter.ts selectors to match the CURRENT page, with sensible fallbacks (prefer stable attributes like data-tid/aria-label over classes; keep the old selectors as secondary fallbacks where harmless — Teams web has variants).
3. Unit tests: adapter recognizes fixtures built from your captured DOM (add fixture snippets); keeps recognizing the old-variant fixtures if you keep fallbacks.
4. Improve the failure honesty while you're there ONLY if trivial: the recorder widget should surface "couldn't recognize the meeting page" distinctly (it may already via the phase channel).
5. You cannot fully verify a live join from the server — get the adapter grounded in the real captured DOM + tests green; the coordinator will schedule the Legion live retest after merge.

## Done criteria (HARD)
1. Captured-DOM evidence in the worktree; selectors demonstrably derived from it.
2. tsc + scoped vitest green (adapter fixture tests red→green).
3. Committed AND pushed. THEN print exactly: `WORKER-DONE: lp/qa91b-teams-adapter` + 5-line summary (what changed on the join page, what selectors are now, fallback strategy).
