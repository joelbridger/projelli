# Relay: coordinator-9 → coordinator-10 (LIVING DRAFT — updated 2026-07-06 ~12:00 UTC; verify tips/lanes with git + tmux)

> **LATEST (12:00):** 18 merges. QA-91 fully CONQUERED (retest 4 PASS — card visible 5m25s to a real 2nd participant). Dry-run TAKE 1 failed at step-4 local-AI: engine finished in 82s, app gave up at 45s — fixed by lp/localai-patience (scaled first-token budget + provider-timeout alignment + honest "reading your documents" state) @abcedeb0. **Dry-run TAKE 2 now running on the Legion at abcedeb0** (brief: coordination/briefs/w-dryrun-brief.md + the updated step-4 expectation). All 5 post-demo branches pre-reviewed AND repaired (16 review catches total). Runbook content-complete; stamp = remove banner after 3/3 clean + fold task #16's noted additions (incl. "narrate the privacy pitch during the local think time"). NEED-JAMESON still open: Microsoft security code for Outlook on the Legion (non-blocking).

You are **cc-lantern-coordinator-10**, coordinator of the lantern-plus fork. NO product code — spawn/manage `cc-lantern-*` workers over tmux; you are the SOLE merge gate. Comms with Jameson: explain like he's 10 (his THIRD correction — short sentences, everyday words/analogies, never a codename/path/command as the main content).

## ⚡ First actions
1. Re-arm monitors (they die with the session): finish-watch (`coordination/tools/lantern-finish-watch.sh`) + idle-capacity (`coordination/tools/lantern-idle-capacity.sh 600` — 10-min cadence, includes Jameson's standing parallelism question; answer it FRESH each firing).
2. `git -C ~/lantern-plus rev-parse HEAD` + `tmux ls` — reconcile against this file.
3. Read TaskList (live board), then continue the endgame below.

## 🎯 State of the mission (Demo V1, coordination/DEMO-V1.md)
- **Steps 1,2,3,4,6 = GREEN and verified** (QA-92 killed + verified on BOTH benches: Ask finds pre-existing files, citations, close/reopen, Local AI — see legion/bench1 evidence branches).
- **Step 5 (meeting Notice Card): 3 of 4 layers beaten**, live-proven visible to a real second participant, then force-closed by its own stale "am I admitted?" detection ~28s post-admission (false "couldn't join" to the presenter). **Layer 4 lane cc-lantern-qa91d (Opus)** is fixing: real captured post-admission DOM + ADMISSION-IS-A-LATCH policy (post-admission unrecognized must never self-destruct/report failure). After its merge → Legion live retest round 4 = step-5 decider.
- **13 merges this shift** (QA-92 3-hole fix; QA-91 layers 1-3; QA-85 real verify badge; QA-90 honest still-importing; connect hardening; localai readiness; verify-timing races; sidebar/tour; demo workspace + runbook + 10 edits; monitor fixes). Full details: STATUS.md top entry + CHANGELOG.
- **TIP FREEZE:** pre-3×-dry-run merges allowed ONLY for demo-path fixes (qa91d, lp/dressrun-fixes); everything else queues post-demo.

## Lanes (verify with tmux, don't trust blindly)
- **cc-lantern-qa91d** (Opus) — layer-4 fix. Merge FIRST when done (full gate), then Legion retest round 4.
- **cc-lantern-keycheck** — lp/dressrun-fixes: persistent "✓ Working" key state + Local-AI mode-switch warm-up (dress-rehearsal findings F1/F5). Merges PRE-3× too.
- **cc-lantern-legionverify** (Legion driver, warm context) — staging jobs: real Outlook connect + 30-PDF step-3 trigger kit. Then: retest round 4, then the 3× dry-run.
- **cc-lantern-swallow7** (Opus xhigh) — swallow-p0 round 7 build-only (spec = coordination/reports/swallow-p0-close-verdict.md). POST-demo merge.
- **cc-lantern-secondwave** — lp/connector-parity build-only (OneDrive disconnect ordering, Outlook cancel rollback, useChatSending markKeyInvalid). POST-demo merge.
- **cc-lantern-uishots** (bench-1 driver) — screenshotting lp/ui-simplification for Jameson's pre-merge eyeball. DEALLOCATE bench-1 when it finishes.
- **DONE, parked branches awaiting post-demo merge:** lp/ui-simplification @b2bbc6ac (+ Jameson visual OK), lp/reindex-swap @33c7accb (LanceDB merge_insert atomic swap).

## The endgame sequence
qa91d merge → Legion retest 4 (PASS = all six green) → merge lp/dressrun-fixes → **3× clean dry-run on the final tip** (task #4) → stamp DEMO-RUNBOOK final (task #16 description holds ALL pending edits: dress findings F2/F4/F6, pre-flight notes) → notify Jameson DONE → open the post-demo merge window (order: swallow7 → connector-parity → reindex-swap → uisimp after Jameson's OK) → then QA-93 (after swallow7; same code neighborhood) → folder-cleanup/rename (Jameson-approved, resets dev data).

## Gate recipe (unchanged, EVERY merge)
Backup tag → codex-review from the warm worktree in a DEDICATED TMUX RUNNER (backgrounded codex gets KILLED — bit us twice; sentinel `REVIEW-DONE-EXIT:$?` + anchored Monitor grep `REVIEW-DONE-EXIT:[0-9]+`) → verify findings vs HEAD → merge --no-ff → tsc + full vitest with BARE EXIT CODE (`npx vitest run > log 2>&1; echo EXIT:$?` — a pipe to grep/tail MASKS failures; I pushed a red tip once this shift doing that) → cargo only if Rust touched → red = reset to backup tag → push --no-verify.

## Landmines (hard-won this shift)
(a) Multi-line tmux send-keys needs a SEPARATE C-m; long pastes may need 1-2 extra Enters ("paste again to expand"); messages sent mid-turn QUEUE (fine) but sometimes sit unsubmitted — always capture-pane to confirm. (b) Workers repeatedly idle on background-notification waits — wake them with the WORKER-DISCIPLINE.md foreground-poll rule. (c) Workers must run SCOPED tests only (full suites piled up = load 150+, flaky everything — rule now in WORKER-DISCIPLINE.md). (d) "DONE" means PUSHED — git ls-remote verify every sentinel. (e) Fresh lp-* worktrees need public/ocr/* copied in. (f) Session-limit pauses: workers hit their own 5h limits (~5:30 UTC reset seen); usage-credit balance is $0 — never buy without Jameson. (g) The idle-capacity Legion-driver grep only knows names matching winsmoke|legion*|smoke* — new Legion drivers should match or update the script.

## Locked constraints
Never release/deploy. Never rename matter_id/Matter. No cloud transcription. AI docx author = "Advisor Prep Hero AI". Only the coordinator merges. Workers cc-lantern-* only. Real-money actions (credits, purchases) = Jameson only.
