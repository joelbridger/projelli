# Worker brief — bench-2 driver: parallel Notice Card live retest (QA-91 fix verification)

You are **cc-lantern-bench2**, worktree **~/lp-bench2**, branch **lp/bench2-evidence** (evidence lane off tip 4cafb72f). You DRIVE the Azure Windows VM `lantern-cloud-bench-2` (RG `lantern-bench`, start was just requested — poll `az vm get-instance-view` until running, then Tailscale). You do NOT merge. Evidence pushes always `git push --no-verify`. Never run the repo test suite.

## Read first
- `coordination/azure-bench/SETUP-LOG.md` (bench-2 specifics; VB-CABLE fake audio is installed on THIS VM; creds pointer — never echo)
- `docs/qa/BENCH-SMOKE-HARNESS.md` (build/deploy/drive flow; CDP 9223)
- `coordination/qa-campaign/evidence/winsmoke-qa90-91/SCORECARD.md` (branch lp/winsmoke-evidence — EXACTLY how the previous 2-person Teams notice test was run; copy its method)

## Context
QA-91: the in-meeting "Recording Notice" card never joined (WebView2 args mismatch, 0x8007139F). The fix MERGED at tip **4cafb72f** (shared browser-args for both windows). The Legion will retest later; YOU are the parallel first check — if you PASS cleanly, the demo's last unknown closes early.

## Mission
1. Wait for the VM to be up (poll in a foreground loop with a hard timeout, ~10 min; then Tailscale/SSH reachable). If it won't come up in 15 min of honest attempts, report BLOCKED.
2. Bring bench-2's app to tip **4cafb72f** (established build/deploy flow; bench-2 got the CDP fix merged long ago).
3. Run the 2-person Teams Notice Card test, winsmoke's method: create a live meeting via "Meet now" on teams.live.com from the SERVER's Chrome (chrome-cdp session — it holds the signed-in account; that Chrome tab is the HOST and a real participant). Paste the join URL into the bench-2 app's "Record this meeting?" dialog, consent, start recording.
4. On the HOST side (server Chrome), WATCH for the "Recording Notice" guest knocking (can take up to ~2 min) and ADMIT it.
5. **SUCCESS =** the notice-card tile shows VISIBLE CARD TEXT (not a black/empty tile) in the meeting as seen by the host participant — screenshot that view. Also note how long join took, and whether the app's recorder widget reflected the true state.
6. Evidence + `coordination/qa-campaign/evidence/bench2-qa91-verify/REPORT.md` (exact tip SHA, PASS/FAIL, timings) → commit + push (`--no-verify`).

## Rules
- Poll everything yourself in foreground loops; never idle waiting on a background notification.
- If the card fails to join: capture the app logs' WebView2/notice-card lines precisely — that distinguishes "same crash" from "new failure". Report FAIL with the signature; do not retry more than twice.
- When done and idle, say so plainly — the coordinator handles VM power (do not deallocate yourself).

## Done criteria (HARD)
Evidence committed AND pushed. THEN print exactly: `WORKER-DONE: bench2-qa91-verify` + PASS/FAIL + one-line timing summary.
