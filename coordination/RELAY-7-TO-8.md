# Relay: coordinator-7 → coordinator-8 (2026-07-05)

You are **cc-lantern-coordinator-8**, the Fable/Opus coordinator of the lantern-plus fork.
You do **NO product code** — you spawn/manage `cc-lantern-*` workers and are the **sole merge gate**.
Read first: `LANTERN-PLUS.md`, `docs/qa/QA_BOARD.md`, `coordination/qa-campaign/BUG-DB.md`, `coordination/WORKER-DISCIPLINE.md`.

## Current tip
`origin/lantern-plus` = **83a0cd0d**. Backup tag before next merge: `backup/pre-swallowbatch-83a0cd0d`.

## 🎯 THE NEXT ACTION (do this first)
**Merge `lp/swallow-batch` (7ca89c53) — it is REVIEWED CLEAN and ready.** codex-review found only one P2 (QA-73, stale calendar-error banner) which I filed as a NON-BLOCKING follow-up. Run the full gate and merge:
1. Backup tag already exists (`backup/pre-swallowbatch-83a0cd0d`).
2. `cd ~/lantern-plus` (on branch lantern-plus) → `git merge --no-ff origin/lp/swallow-batch`.
3. Gate: `npx tsc --noEmit` then **full vitest FOREGROUND BARE** (`npx vitest run` — pipes mask exit codes) then cargo via the `lp-gate-build` tmux runner (`CARGO_TARGET_DIR=$HOME/.cargo-target-lp-gate`, run from `src-tauri`).
4. Green → `git push --no-verify`. Red → `git reset --hard backup/pre-swallowbatch-83a0cd0d`.
5. Expect the recurring `en-json-snapshot.test.ts` conflict (hardcoded key count) — resolve by `node -e` flatten to compute the true count.

## Merge queue (pushed to remote, awaiting your gate)
| Branch | SHA | State | Gate note |
|---|---|---|---|
| `lp/swallow-batch` | 7ca89c53 | **REVIEWED CLEAN** (only P2 QA-73, filed) | ← MERGE FIRST |
| `lp/guardrails` | 7db6462a | codex-review RUNNING (`cc-review-guardrails`; log `scratchpad/review-guardrails.log`, watch for `REVIEW-EXIT-SENTINEL`) | read verdict → gate → merge. Lint+i18n gate — low risk. |
| `lp/qa60-case-fix` | 45198776 | **P0 Windows boot-blocker** (case-collision `MeetingNoteOutboundGate.tsx`/`.ts`). Pushed (I rescued it — worker froze mid-push). | **MUST Windows-boot-verify on the Legion (free, reserved for this) BEFORE merge.** Highest-priority merge after verify. |
| `lp/swallow-p0` | 9be74efb | **P0 privilege-retag** BUT review found a P1 hole in its own new `retagScheduler.ts` (superseded retries not cancelled → can re-apply stale client/privilege). | **DO NOT MERGE** until `cc-lantern-schedfix` (Opus, building on this same branch/worktree `~/lp-swallowp0`) pushes + you re-review just that delta. |

## Building lanes (workers still working — check status, push-verify, then review+gate)
- `cc-lantern-cleanup4` — QA-43 P0 second-cycle save regression + docx keep-alive + test flake.
- `cc-lantern-racep0` — **cross-client isolation** QA-52..59 + QA-62 (workspace-store not namespaced) P0. **HIGHEST scrutiny** at gate.
- `cc-lantern-schedfix` — closes the swallow-p0 P1 (see above). Opus.
- `cc-lantern-guardrails` — done/pushed (review running).

## Real-Windows hunts (find bugs continuously — Jameson's standing directive)
- `cc-lantern-hunt4` — **bench-1 (RUNNING)**, docx/save-integrity/connector angle. Files QA-##, then `WORKER-DONE: hunt4` + **must deallocate bench-1**.
- `cc-lantern-ragleak` — **bench-2 (RUNNING)**, **QA-68 RAG cross-workspace leak — potential WORST leak** (can one client's docs surface in another's Ask answers?). It kept freezing on a build-poll; I re-nudged it to actively verify the bench-2 build. **Watch it; deallocate bench-2 when done.** Verdict pending — this is the highest-value open test.
- hunt3 DONE → filed **QA-69** (Windows sleep-lock never released — battery bug, Rust `sources.rs`), **QA-70** (kill mid-transcription → meeting stuck "queued" forever, no retry), **QA-71** (dangerous "delete audio" copy when no transcript exists = destroys only copy), **QA-72** (POSITIVE: meetings cross-client isolation verified clean). **Legion is now FREE — reserve for the qa60 boot-verify.**

## ⚠️ Benches cost money — bench-1 + bench-2 are RUNNING. Deallocate each when its hunt finishes. RG = `lantern-bench`.

## Follow-ups filed / staged (not yet lanes)
- **rust-harden** (QA-65/66/67 panic-sweep) STAGED; fold **QA-69** (Windows wake-lock, `SetThreadExecutionState(ES_CONTINUOUS)` via windows-sys `Win32_System_Power`) into that single Rust compile lane.
- **meetings-recovery lane** (task #45) — QA-70 + QA-71. HOLD until a P0 clears the gate, then spawn.
- QA-61 (overlong name silent doc-fail), QA-73 (P2 calendar banner), QA-68 (in test).
- Tier C P1 (provable-record) — HOLD until isolation P0s + Notice Card clear.
- **NEEDS JAMESON**: fork→main integration timing; 3 Tier-C product Qs (Summary-only mode, external witness, data-destroying shortcut); calendar invite-body WRITE scope (OAuth upgrade).

## 🔴 Doctrine learned THIS session (enforce it)
**Three workers froze the same way today** (swallowbatch, swallowp0, ragleak): armed a background build/gate poller, went idle, never pushed — I rescued+pushed all three. Added to `WORKER-DISCIPLINE.md`: *never arm a background poller and go idle; poll foreground with a hard timeout and act same-turn.* This compounds **push-before-done** (in the spawn preamble). **When any worker prints WORKER-DONE, VERIFY the branch is on the remote (`git ls-remote`) before trusting it** — and if a worktree has uncommitted work, commit+reconcile+push it yourself.

## Gate recipe (canonical)
backup tag → codex-review from a WARM worktree (`--base origin/lantern-plus`, **no prompt** — prompt+base conflicts, exit 2) in a dedicated tmux runner with an EXIT sentinel + Monitor → verify each finding vs HEAD (proposals, not gospel) → `merge --no-ff` → tsc + **full vitest FOREGROUND BARE** → cargo via `lp-gate-build` runner → red = `reset --hard` to backup tag → `push --no-verify`.

## Monitors I had armed (they die with my session — re-arm your own)
guardrails-review completion; fleet finish-watch (`cc-lantern-*` idle/done); stale-idle watch; the idle-capacity monitor (`coordination/tools/lantern-idle-capacity.sh` — its grep needs `hunt4` added and `hunt3` is done). Re-arm the idle-capacity + finish-watch monitors first thing.

## Locked constraints (never violate)
Never release/deploy the fork. Never rename `matter_id`/`Matter` (facade). No cloud transcription EVER. AI docx author stays "Advisor Prep Hero AI". Only the coordinator merges. Workers are `cc-lantern-*` only.
