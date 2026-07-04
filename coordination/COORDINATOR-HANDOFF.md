# LANTERN-PLUS COORDINATOR HANDOFF — relay #4 (post-reboot). Read fully, then continue.

*Written 2026-07-03 night by coordinator-3 (Fable) immediately before a PLANNED SERVER REBOOT:
Jameson is installing a 2TB NVMe for dev caches. You were spawned by the @reboot hook
(`coordination/tools/post-reboot-resume.sh`). You are the Lantern-Plus coordinator: Fable 5 ·
high effort (xhigh at merge/review gates). You do NO product work yourself — spawn/manage
workers (Sonnet 5 default). Only you merge.*

## Read order (before acting)
1. `~/keepance-coordination/coordinator/PLAYBOOK.md` — fleet technique (commandments, monitors, merge ritual, model routing).
2. `~/lantern-plus/docs/plans/lantern-plus/PARALLEL-OPERATIONS.md` — BINDING coexistence rules with main line.
3. `~/lantern-plus/coordination/STATUS.md` — live board (top entry = current).
4. `~/keepance-coordination/PARALLEL-EFFORTS.md` — shared bulletin + LIVE SCOREBOARD (edit our row in place; heartbeat is AUTOMATED via fleet-heartbeat cron — don't hand-stamp).

## DO FIRST (in order)
1. **Verify the box came back healthy**: `df -h /`, `free -h`, `tmux ls` (expect ~nothing), and that `notify-jameson` works — then send Jameson a short "server back, fleet resuming" note (info level).
2. **Set up the NEW 2TB NVMe** (the whole point of the reboot): find it (`lsblk -d -o NAME,SIZE,MODEL | grep -v loop` — the new ~1.8T nvme device that is NOT nvme0n1/931.5G root). It arrives with Windows partitions — WIPE it (it's sanctioned: Jameson pulled it from his desktop for exactly this): GPT label, one ext4 partition, `mkfs.ext4 -L devcache`, mount at `/mnt/devcache`, add to `/etc/fstab` by UUID (`nofail`), `chown jameson:jameson`. Then MIGRATE the cargo caches: `rsync -a ~/.cargo-target-lp-w4/ /mnt/devcache/cargo-target-lp-w4/` (same for lp-w4d, lp-gate), replace the home-dir paths with SYMLINKS (`mv ~/.cargo-target-lp-w4 ~/.cargo-target-lp-w4.old && ln -s /mnt/devcache/cargo-target-lp-w4 ~/.cargo-target-lp-w4`; delete the .old after a lane compiles green). Symlinks mean NOTHING else (briefs, worker envs) needs to change. Root NVMe frees ~215G → the disk constraint is GONE.
3. **Re-arm ALL 6 monitors** (they died with the reboot): fleet watcher (`coordination/tools/lantern-finish-watch.sh`), RAM+disk watchdog (<25G alarm — after migration this should be quiet), diff-based bulletin watcher (NOT tail -F — in-place scoreboard edits re-trigger tail; see coordinator-3's diff/snapshot pattern in STATUS or rebuild: snapshot copy + `diff` every 60s, filter out our own signatures), stale-idle backstop (`coordination/tools/lantern-stale-idle.sh`), build-overtime (`coordination/tools/lantern-build-overtime.sh`), parallel-check 15-min heartbeat. Then a BASELINE manual sweep.
4. **Respawn the two build workers** (their tmux sessions died; their WORK is safe — committed+pushed with PARK-HANDOFF.md in each worktree):
   - w3 / Wave-3 capture: worktree `~/lp-w4`, branch `lp/meeting-capture`. Spawn `cc-lantern-w3` in that dir; prompt = "Read coordination/briefs/w-wave3-brief.md (your original brief; Task-0 spike already PASSED — cpal loopback proven on the Legion) + PARK-HANDOFF.md in your worktree root; continue from your last commit." It was mid Task 5 (crash recovery); Tasks 1-4 done. CARGO_TARGET_DIR=$HOME/.cargo-target-lp-w4. Its Task 6 needs the LEGION (reserved, ours).
   - w4d / Wave-4 Track D retention: worktree `~/lp-w4d`, branch `lp/retention`. Spawn `cc-lantern-w4d`; prompt = "Read coordination/briefs/w-wave4-d-brief.md + PARK-HANDOFF.md; continue." It was mid Task 14 (sweep engine — xhigh-review class). CARGO_TARGET_DIR=$HOME/.cargo-target-lp-w4d.
5. **Open the two queued lanes the new disk unblocks** (this was the constraint — it's gone now):
   - CRM wire-fix lane (Task-list #12): brief the 2 live-probe bugs from `docs/evidence/windows-smoke-2/WEALTHBOX-PROBE.md` (branch `lp/windows-smoke-evidence`): (a) Wealthbox tasks 422 without due_date → client-side required validation; (b) `wealthbox_wire_field_name` write-direction is WRONG — writes must send the literal `background_information` (reads keep `background_info`); robust route = split read/write translation + post-write readback verification + regression tests. Small lane; seed its cache on /mnt/devcache from lp-gate.
   - Wave-4 Track A (diarization): brief from the wave-4 plan "Track A" section (sherpa-onnx models, within-channel diarization + voiceprint naming). Check its Legion needs vs w3's Task 6 — serialize Legion use.

## Current state (at reboot)
- **Tip: `lantern-plus` pushed, all green (5608 vitest + cargo at last Rust merge). MERGED today: smoke P0 fixes, Wave-4 Tracks B+C, Wave-1 Task 19 (rescan), Windows matter-resolver fix, downstream #6.**
- 🏁 **WAVES 0-2 ARE BENCH-VERIFIED end-to-end on real Windows** (the recalibrated done-bar): evidence `docs/evidence/windows-smoke-2/` on `lp/windows-smoke-evidence` (RUN-LOG + WEALTHBOX-PROBE + Wave-4 UI screenshots). Wealthbox live-probe resolved 6 VERIFY-LIVE unknowns; its 2 wire bugs are the queued fix lane above (dormant paths — MUST merge before any field-update/task producer UI ships).
- **Wave 3**: spike PASSED (WASAPI loopback via cpal proven; commit on `lp/meeting-capture`), engine Tasks 1-4 done, Task 5 in progress at park. Engine unlocked early (my judgment, logged): waves 0-1 verified + spike green; MERGE still requires my xhigh review (capture + crash-recovery diffs).
- **Wave 4**: B+C merged (Book view, estate mismatch, whole-practice Ask — isolation guard passed xhigh). Track D mid-build (park at Task 14). Track A queued (above). Reachability audits #1+#2 in `coordination/smoke-1/` (audit #2: zero unreachable).
- **De-passkey DONE**: Sarah Morgan test account = password+TOTP in `~/keepance-coordination/demo-creds/sarah-morgan-account.md` (chmod 600); autonomous sign-in proven; keep sign-ins light-touch (MS anti-automation triggered once on rapid retries).
- **Azure cloud bench**: `lantern-cloud-bench-1` exists, deallocated ($0), guardrails armed, snapshot saved; known MSVC-linker gap + exact fix in `coordination/azure-bench/SETUP-LOG.md` (queued follow-up). Jameson granted STANDING AUTHORITY to create a 2nd VM when clearly useful (memory: project-azure-cloud-bench).
- **Legion**: RESERVED for us (scoreboard). w3 Task 6 needs it next; release to main line only after Wave-3/4 bench checks (they want it for Jameson's personal test).
- **Rename window (main line)**: Phase 2 executes in the next GENUINE quiet window (no fixed clock, awaiting Jameson's timing) — freeze downstream merges between their EXECUTING and DONE bulletin lines.

## Merge queue & discipline
- Empty at park. Order when lanes hand off: likely w4d (retention — xhigh on Tasks 14/15/17b; deletion code, be brutal) and w3 (capture — xhigh on capture-engine + crash-recovery). One merge in flight; ritual per playbook §4 (backup tag → independent codex-review from the WARM worktree with worker idle (`--base origin/lantern-plus`, NO custom prompt — the CLI rejects prompts with --base/--commit) → verify findings vs HEAD → merge --no-ff → tsc+vitest foreground; Rust-touched ⇒ cargo via the `lp-gate-build` tmux runner (KEEP that session; cwd must stay /home/jameson/lantern-plus) → red=rollback → push --no-verify). CHANGELOG per merge; notify-jameson per milestone (plain language, explain-like-16); PRODUCT-JOURNEY only for major moments (today's entry done).
- **Wave-3/4 bench verification is part of DONE** — a wave isn't done until driven on the Legion (the smoke-1/2 lesson; don't backslide).

## Landmines (hard-won today, keep)
- NEVER touch ~/keepance / push keepance-3.0 / release from this fork. Never rename `matter_id`/`Matter`. No cloud transcription EVER. Workers `cc-lantern-*` only.
- Bench/evidence workers SWITCH ~/lantern-plus to `lp/windows-smoke-evidence` to commit evidence — `git branch --show-current` BEFORE every coordination commit; tell such workers to switch back (one stray commit already had to be cherry-picked).
- Codex-review CLI: `--commit`/`--base` REJECT a custom prompt arg. `--base` only from the warm worktree with the worker idle.
- tail-F bulletin watchers false-fire on in-place scoreboard edits (file rewrites) — use the diff/snapshot watcher.
- Worker idle-BG trap: codex/cargo background shells finish silently — nudge workers to poll (fleet-watcher ACK_IDLE + stale-idle + no-codex-process = the tell).
- Send-keys protocol: Escape, C-u, one-line message, Enter; long content goes in a FILE in the worker's worktree + one-line pointer.
- Commit coordination-doc edits immediately (merge rollbacks discard uncommitted edits silently).
- Every notify to Jameson: plain language, define terms, no jargon-as-content. Interview-first for new feature scope; lean execution for the how.

## Parked for Jameson (surface gently)
Google OAuth calendar filing (pack ready — WEEKS of review lead time, file early); discovery-interview campaign (staged, unfired — the one thing only he can do that feeds Phase 2); vendor API filings (Redtail/Salesforce/DocuSign); product Qs already asked (Calendar/Mail OAuth scope sharing; "Not a client meeting" persistence).

## At YOUR context limit
Playbook §6.1: rewrite this handoff, spawn `cc-lantern-coordinator-5` (Fable · high) via spawn-session.sh --handoff, verify boot, end.
