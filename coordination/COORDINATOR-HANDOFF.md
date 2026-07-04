# LANTERN-PLUS COORDINATOR HANDOFF — relay #6→#7. Read fully, then continue.

*Written 2026-07-04 ~09:00 by coordinator-6 (Fable) at a clean checkpoint after a very long, productive
session. You are coordinator-7 (Fable · high; xhigh only at merge/review gates). You do NO product work
yourself — you spawn/manage workers (Sonnet 5 default; Opus 4.8 for hardest correctness-critical; Fable
now ALLOWED for judgment-heavy lanes per Jameson 2026-07-04 — see memory feedback-fable-workers-allowed).
Only YOU merge. Repo tip is pushed and clean.*

## DO FIRST (in order)
1. **Re-arm ALL monitors** (they die with the previous session). Arm as persistent harness Monitors:
   - fleet watcher: `bash ~/lantern-plus/coordination/tools/lantern-finish-watch.sh`
   - RAM+disk watchdog (mem avail<1500MB or swap>90%&avail<4000MB; disk<25G on / AND /mnt/devcache)
   - bulletin diff-watcher on `~/keepance-coordination/PARALLEL-EFFORTS.md` (snapshot+diff/60s, filter own lines)
   - stale-idle: `bash ~/lantern-plus/coordination/tools/lantern-stale-idle.sh`
   - build-overtime: `bash ~/lantern-plus/coordination/tools/lantern-build-overtime.sh`
   - strategic-check (10-min whole-project trigger): `bash ~/lantern-plus/coordination/tools/lantern-strategic-check.sh`
2. **Baseline full sweep** of every `cc-lantern-*` session (watchers only see the future).
3. Read `coordination/STATUS.md` (top entry = current state), `coordination/LANES.md` (live board),
   `coordination/QA-CAMPAIGN.md` + `coordination/qa-campaign/BUG-DB.md`, `coordination/QUESTIONS-FOR-JAMESON.md`.
4. Read `~/keepance-coordination/coordinator/PLAYBOOK.md` (fleet technique). NOTE `~/keepance` is now a
   SYMLINK to `~/lantern` (rename Phase 2 done — old paths still work).

## WHERE THINGS STAND (2026-07-04 ~09:00)
**Repo:** branch `lantern-plus`, tip pushed & clean. Backups: `/mnt/devcache/backups/lantern-20260704` + `~/backups`.

🎬 **THE MEETINGS TAB IS BUILT + MERGED** (Jameson caught it was missing; it's now real): transcription
engine (w3b) + full surface (w3c) — per-client Meetings tab between Email/Activity, record pill, transcript
viewer w/ audio-seek, notes, consent dialog+ledger, dictation filing, wired to real transcribe_meeting.
Independent review + rebase caught 4 consent/timing metadata-integrity bugs + dup-audit + UI-timing, all
fixed pre-merge. Also merged tonight: symlink-hardening, meeting capture, audit fail-closed, Windows
pathguard, wave4 gap-sync, azure CDP fix, e2e mirror, harness v3, cleanup+brand-fix, diarize release
staging, CRM-card QA-1..4, qafix1 (QA-5 new-client folders + QA-6 Ask layout). Rename Phase 2 done.

## TWO ACTIVE LANES (manage to merge)
1. **cc-lantern-w3ux** — worktree `~/lp-w3ux`, branch `lp/wave3-meetings-ux`, **FABLE**. The SENIOR-UX
   gate on the assembled Meetings tab (brief `coordination/briefs/w-w3ux-brief.md`). Produces a ranked
   findings doc (`docs/design/2026-07-04-meetings-tab-ux-review.md`) + scoped polish branch. **Legion is
   RESERVED for its live record-a-meeting verification** — give it a slot when it asks. After it merges →
   drive the live Legion walkthrough (record real meeting → read notes) with screenshots for Jameson →
   **only then re-declare the Meetings feature DONE** (task #18).
2. **cc-lantern-qafix2** — worktree `~/lp-qafix2`, branch `lp/qa-fix-batch2`. QA-7 (Ask hang→timeout/error
   feedback, the P1, unit-tested & solid) + QA-8/9 (onboarding overlaps, P2 cosmetic). **⚠️ LANDMINE / DO
   NOT MERGE YET:** its onboarding-overlap Playwright spec (`tests/e2e/bench-mirror-onboarding-overlap.spec.ts`)
   FAILS 2 QA-8 cases in a fresh-server run (selector `intro-flow-icon-0 svg` matches no node; Lottie
   renders `kp-onbv2-lottie`, no svg child). Routed back with an A/B resolution (fix the selector to the
   real container box, OR move the QA-8 no-overlap guard to the unit level and drop the flaky Playwright
   icon assertion). Verify its re-handoff with a **bare exit code** (kill all vite servers first;
   `reuseExistingServer:!CI` = stale servers cause false results — this bit me twice).

## MERGE DISCIPLINE (per playbook §4)
backup tag → **independent codex-review from the WARM worktree, worker idle** (`--base origin/lantern-plus`)
→ verify findings vs HEAD → merge --no-ff → tsc + full vitest FOREGROUND; Rust-touched ⇒ cargo via the
`lp-gate-build` tmux runner (KEEP it; CARGO_TARGET_DIR=$HOME/.cargo-target-lp-gate) → red=rollback → push --no-verify.
- **RUN GATE COMMANDS BARE — a pipe to `tail` MASKS the playwright/vitest exit code** (bit me on qafix2).
- **codex-review backgrounded calls get KILLED under fleet load tonight** (~5 lanes hit it). YOUR independent
  review from the warm worktree in a dedicated tmux runner (with a `-EXIT:$?` sentinel + Monitor) is the real
  gate and has caught 6 real defects tonight (brand leak, release-corruption, compliance P1, harness false-pass,
  broken E2E spec, + more). Cap worker self-review loops; don't let a killed-codex retry loop spin.
- Per-lane cargo caches on /mnt/devcache (symlinked ~/.cargo-target-lp-*). Delete a lane's cache on close.
- Commit coordination-doc edits immediately (rollbacks discard uncommitted edits). NEVER operate git in the
  main `~/lantern-plus` checkout for verification (I slipped into a detached HEAD once — verify in the lane's
  OWN worktree).

## AFTER the two lanes → the finish line for Wave 3
UX-gate polish merged + Meetings live-verified on the Legion (screenshots to Jameson) → re-declare Meetings
DONE. Then the QA campaign continues (Jameson's standing order): personas B (daily-driver), C (klutz), D
(edge-case catalog) as explorers on the cloud benches; Zoom + Google Meet call-recording tests (Teams already
CONFIRMED — realcall evidence). Triage remaining QA findings: QA-10 (Go! CTA invisible — needs real-Windows/human
eyes), QA-11/12 (P3). **Pace new QA explorers to your review capacity — YOU are the serial merge gate; more
explorers than you can triage is negative throughput.**

## PARKED FOR JAMESON (surface gently; none block work; defaults in QUESTIONS-FOR-JAMESON.md)
- The Jump battle-plan's 9 board decisions (go-to-market — the real mission now).
- Fork→main integration (recommend after Wave 3 + QA settle; it also unblocks the shelved ui/reimagine pass #9).
- Zoom/Meet test-account creation (default: yes, demo identity). Mac meeting-capture sidecar (needs M1 bench;
  after Wave-3 UI ships). His personal app test (#10). Rename follow-ups (#17). Local Windows VM pickup (#12 blocked-w-findings).

## LANDMINES (keep)
- NEVER release/deploy the lantern-plus fork. Website + rename live in `~/lantern` (keepance-3.0). Never rename
  `matter_id`/`Matter`. No cloud transcription EVER. Workers `cc-lantern-*` only. AI_AUTHOR (docx author) must
  stay the BRAND "Advisor Prep Hero AI" (a codename leak into customer Word docs was caught+fixed tonight).
- Legion is the shared Windows bench (one driver). Cloud: bench-1 + bench-2 (deallocated; snapshots incl
  lantern-cloud-bench-ready-1). ~/lp-bench is the permanent evidence worktree on lp/windows-smoke-evidence.
- The 2-way sharded smoke + auto-smoke (dry-run) + browser mirror are live testing tools (docs/qa/, scripts/).

## At YOUR context limit
Playbook §6.1: rewrite this handoff, spawn `cc-lantern-coordinator-8` (Fable · high) via spawn-session.sh
--handoff, verify boot, end. The mission never pauses for a human.
