# LANTERN-PLUS COORDINATOR HANDOFF — relay #5→#6. Read fully, then continue.

*Written 2026-07-04 by coordinator-5 (Fable 5) at Jameson's request for a clean wrap + fresh
coordinator. You are the SOLE coordinator on this server now (see "Consolidation" below) — Fable 5 ·
high (xhigh only at merge/review gates). You do NO product work yourself — spawn/manage workers
(Sonnet 5 default; Opus 4.8 only for hardest correctness-critical; NEVER Fable workers). Only you merge.*

## Read order (before acting)
1. `~/keepance-coordination/coordinator/PLAYBOOK.md` — fleet technique. **Read the Changelog tail** — many hard-won lessons were added tonight (sentinel self-match, worker review-loop cap, `codex-review --commit` is single-commit scope, dashboard dual-fleet LANES, strategic-check monitor).
2. `~/lantern-plus/docs/plans/lantern-plus/PARALLEL-OPERATIONS.md` — coexistence rules. NOTE: main line has STOOD DOWN (consolidation); the two-fleet regime is historical but the cargo/port/Legion discipline still applies.
3. `~/lantern-plus/coordination/STATUS.md` + `coordination/LANES.md` — live board (LANES = O(1) lane state; the fleet dashboard reads it).
4. `~/keepance-coordination/PARALLEL-EFFORTS.md` — shared bulletin + scoreboard (main line row now "retired").

## CONSOLIDATION (2026-07-03, Jameson's direct order)
Jameson consolidated to ONE coordinator — YOU. The main-line coordinator stood down (parked, no successor). You absorbed its open items — they are tasks #8–#14 below. Main-line's handoff (for reference): `~/keepance-coordination/COORDINATOR-HANDOFF.md`. You now own BOTH the lantern-plus fork work AND the inherited main-line items (rename, website, its cleanup tickets). The `~/keepance` repo (branch `keepance-3.0`) is still the MAIN product repo — website + rename live there; lantern-plus fork work lives in `~/lantern-plus` (branch `lantern-plus`).

## DO FIRST (in order)
1. **Re-arm ALL monitors** (they died with coordinator-5's session). Arm as persistent harness Monitors:
   - fleet watcher: `bash ~/lantern-plus/coordination/tools/lantern-finish-watch.sh`
   - RAM+disk watchdog (alarm <25G on root AND /mnt/devcache; the inline script coordinator-5 used — MEM avail<1500MB or swap>90%+avail<4000MB; DISK<25G on / and /mnt/devcache)
   - bulletin diff-watcher on `~/keepance-coordination/PARALLEL-EFFORTS.md` (snapshot+diff every 60s, filter your own lines — NOT tail -F)
   - stale-idle backstop: `bash ~/lantern-plus/coordination/tools/lantern-stale-idle.sh`
   - build-overtime: `bash ~/lantern-plus/coordination/tools/lantern-build-overtime.sh`
   - **STRATEGIC-CHECK (the 10-min whole-project trigger, replaces the old parallel-check):** `bash ~/lantern-plus/coordination/tools/lantern-strategic-check.sh` — each firing OBLIGATES you to answer "looking at the WHOLE project, what else could run in parallel / speed testing safely / raise throughput?" Answer concretely or state why current shape is optimal.
2. **Baseline full sweep** of every `cc-lantern-*` session (the watchers only see the future).
3. **Check the two active lanes** (below) and the symlink-audit follow-through.

## Current state (tip `e40626a6`, pushed, all green: 5670 vitest + 1173 cargo at last Rust merge)
🏁 **WAVES 0,1,2,4 ALL MERGED.** Tonight (since a planned NVMe-install reboot) landed SIX merges: CRM wire-fixes, bench-smoke harness, Client Map error-classification, Wave-4A diarization, Wave-4D retention, harness round-2. Plus: the Jump battle plan (published), the live vs-Jump page falsehood fix (deployed), the 2TB /mnt/devcache migration (root 87%→~28%), and a codebase-wide symlink-security audit.

**Waves status vs the TRUE done-bar (merged+unit-green ≠ done; real-Windows bench-verified IS the bar):**
- Waves 0-2: ✅ bench-verified on the Legion (evidence `docs/evidence/windows-smoke-2/`).
- Wave 4 (A diarization, B/C book+ask, D retention): MERGED + unit-green; **NOT yet bench-verified** — needs the full scripted Windows pass.
- Wave 3 (meeting capture): the LAST feature lane, still building (see w3 below). Its spike PASSED earlier (WASAPI loopback via cpal on the Legion).

## TWO ACTIVE LANES (do NOT interrupt; manage to merge)
1. **cc-lantern-symfix** — worktree `~/lp-symfix`, branch `lp/symlink-hardening`. xhigh SECURITY lane. Applying the no-follow symlink-walk primitive (`canonicalize_symlink_safe` from `retention/sweep.rs`) to the 5 containment sites a codebase audit found vulnerable tonight (vault `resolve_and_guard`, mcp_bin `resolve_workspace_path`+`canonicalized_workspace_child`, diarize `ensure_within_workspace`, + harden retention `contained()`). All 3 main sites reported fixed; in review. Brief: `coordination/briefs/w-symlink-hardening-brief.md`. CARGO_TARGET_DIR=$HOME/.cargo-target-lp-symfix. **On handoff:** independent codex `--base origin/lantern-plus` review (this is a security lane — be brutal), then merge. It may PROMOTE the shared primitive to a new module (e.g. `commands::pathguard`) — if so, w3 must re-point its import (see below).
2. **cc-lantern-w3** — worktree `~/lp-w4`, branch `lp/meeting-capture`. Wave-3 capture. Was review-capped at round 17 (green). NOW doing: (a) its Task 6 Legion DEVICE VERIFICATION (owns the Legion; real HEADSET plugged in — cover headset mic capture + loopback + device-switch), and (b) a QUEUED P1 fix: its `capture/mod.rs` guards (`guard_matter_folder`, `guard_meeting_path`) carry the SAME symlink-follow class — must rebuild on the shared primitive + regression tests BEFORE merge. It was told to pull origin/lantern-plus before handoff (tip moved a lot — Wave 4 A+D merged; union conflicts in lib.rs/mod.rs/audit.ts resolve keep-both). CARGO_TARGET_DIR=$HOME/.cargo-target-lp-w4. **Landmine:** w3 references `super::retention::sweep::canonicalize_symlink_safe_absolute`; if symfix relocates that symbol, w3 re-points on rebase (flagged to it already). Merge order: **symfix first, then w3** (w3 rebases onto the moved primitive).

## Merge queue & discipline
- In flight: none. Expected order: **symfix → w3**. Both xhigh (security + capture/crash-recovery).
- Ritual per playbook §4: backup tag → independent codex-review from the WARM worktree with worker idle (`--base origin/lantern-plus`, NO custom prompt with --base) → **verify each finding vs HEAD** → merge --no-ff → tsc+vitest foreground; Rust-touched ⇒ cargo via the `lp-gate-build` tmux runner (KEEP it; cwd /home/jameson/lantern-plus; CARGO_TARGET_DIR=$HOME/.cargo-target-lp-gate) → red=rollback → push --no-verify.
- **⚠️ `codex-review --commit <sha>` reviews ONLY that one commit — for a multi-commit branch use `--base origin/lantern-plus`** (playbook lesson: nearly merged 3,700 lines on a 15-line review tonight).
- CHANGELOG per merge; PRODUCT-JOURNEY only for major moments; notify-jameson per milestone (plain language, explain-like-16).

## AFTER symfix + w3 MERGE — the finish line
1. **Full scripted Windows bench pass** of Waves 0-4 using the NEW harness (`scripts/bench-smoke.mjs` — merged tonight, live-validated 6/8 on the Legion; round-2 added Wave-4 B/C checks + nav helpers). Run it against the Legion (pre-warmed; `BENCH-READY.md` in `docs/evidence/windows-smoke-2/` on `lp/windows-smoke-evidence`). This is what makes Wave 3+4 DONE by the real bar. Fix→re-run to clean.
2. Then the program is FEATURE-COMPLETE against Jump. The battle plan (below) is the go-to-market.

## Inherited / queued TASKS (in the Task tool; also here so they survive)
- **#8 Rename Phase 2** (`~/keepance`→`~/lantern`, symlink-bridged): ATTENDED coordinator step in a genuine quiet window. Plan: `~/keepance-coordination/INITIATIVES/lantern-rename-plan-2026-07-02.md` + `scratchpad/rename-path-inventory.md`. **Awaiting Jameson's timing.** Server-side only, doesn't touch Legion.
- **#9 ui/reimagine holistic pass** — Jameson approved Waves A+B (`ui/reimagine`@3e07fb99, tag `ui-reimagine-approved-2026-07-03`, in `~/keepance`). Shelved until LP features integrate → one holistic pass → Jameson reviews → merge. See `~/keepance/docs/design/UX-DECISIONS-LOG.md`.
- **#10 Jameson's personal app test** — parked by his choice. When he wants it: fresh bench driver → redeploy `9ca325db` → FULL rebuild + freshness canary → clean slate. Snapshot at `C:\bench-backups\jameson-test-build-20260703-070500\` (never touch).
- **#11 inherited cleanup tickets** (none urgent): OneDrive folder-discovery 200s timeout; stale-IPC watcher race (useMemoryWiring.ts:1086); app_data_dir com.keepance→com.lantern; empty keepance-docx crate dir; legacy localStorage migration; keepance-word cosmetic sweep; bench-harness typing-truncation; e2e catch-up-scan check.
- **#12 Final integration: release.yml staging** for the lantern-diarize sidecar+models (a CI installer currently ships WITHOUT speaker separation) + verify Windows DLL-beside-exe + macOS cross-build/codesign of the new libs. Integration-time work; needs a real CI release run to prove — don't pre-build blind.
- **#13 Azure bench WebView2 CDP** never came up (app compiles+launches on `lantern-cloud-bench-1`, but port 9223 didn't). Leads in `coordination/azure-bench/SETUP-LOG.md`. Blocks the harness using the cloud bench as a 2nd target. VM deallocated ($0); snapshot `lantern-cloud-bench-1-clean-2` has the working toolchain (~3-min cached rebuilds).
- **#14 Audit-chain silent-reseal gap** in `EncryptedAuditStore::open()` (`audit/store.rs`): deleting tail rows + `chain_head_v1` metadata directly lets open() reseal the remaining prefix as valid — silent truncation vs tamper-evidence. Cross-cutting file; fix is a design decision (likely fail-closed + repair advisory). Pre-existing. **Queued for the lull after the bench pass** (don't stack a 3rd xhigh security lane on the reviewer now).

## Parked for Jameson (surface gently; NONE block work)
- **Jump battle plan — 9 board decisions** in section 8 (how aggressive publicly, brand name, pricing pilot, switch-credit, legal review, etc.). Published: https://jameworld.com/claudereports/r/2026-07-03-the-jump-battle-plan-lantern-s-strategy-to-replace-jump.html
- Dev-log / Product Journey (republish at each major moment): https://jameworld.com/claudereports/r/2026-07-03-lantern-the-product-journey-development-log.html
- Rename timing (#8). Google OAuth calendar filing + discovery-interview campaign (his unlocks, staged). Vendor API filings (Redtail/Salesforce/DocuSign).

## Landmines (keep)
- NEVER release/deploy the lantern-plus fork. Website + rename are in `~/keepance` (keepance-3.0). Never rename `matter_id`/`Matter`. No cloud transcription EVER. Workers `cc-lantern-*` only, NEVER Fable.
- Per-lane cargo caches on `/mnt/devcache` (symlinked from `~/.cargo-target-lp-*`). One cargo per lane; DISK is the watched resource (<25G alarm on root AND devcache). Delete a lane's cache on lane close.
- Bench/evidence workers commit on `lp/windows-smoke-evidence` (worktree `~/lp-bench` is permanently on that branch — the branch-switch landmine is closed; use it). `git branch --show-current` before any commit in `~/lantern-plus`.
- Sentinel self-match: match a worker's done sentinel as a WHOLE line; never quote the literal `WORKER-DONE: <branch>` string in a tmux MESSAGE (it lands in the watcher window). See playbook.
- Worker review-loop cap: when codex rounds show shrinking severity (~5 rounds, or 2 P3-ish), CAP the worker → hand off; your independent review is the depth gate, not round N.
- Commit coordination-doc edits immediately (merge rollbacks discard uncommitted edits silently).
- lp-gate-build tmux session was found DEAD once tonight post-reboot; recreate if missing (cwd /home/jameson/lantern-plus).

## At YOUR context limit
Playbook §6.1: rewrite this handoff, spawn `cc-lantern-coordinator-7` (Fable · high) via spawn-session.sh --handoff, verify boot, end. The mission never pauses for a human.
