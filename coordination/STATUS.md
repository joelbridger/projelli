# Lantern-Plus Coordination STATUS

*Live board for the Lantern-Plus coordinator (Fable). Playbook: ~/keepance-coordination/coordinator/PLAYBOOK.md (technique) + ~/lantern-plus/docs/plans/lantern-plus/PARALLEL-OPERATIONS.md (coexistence rules — BINDING). Wave plans = the work source. Session names: cc-lantern-*.*

## UPDATE 2026-07-02 (later) — coordinator relay #2 seated
- Successor Fable coordinator took over per COORDINATOR-HANDOFF.md. Monitors re-armed (fleet watcher on cc-lantern-*, RAM+disk watchdog). Baseline sweep done.
- 🚨→✅ DISK EMERGENCY handled at session start: root FS hit 100% (1.5G free), blocking all cargo linking box-wide (w1 flagged it). Freed ~49G of orphaned /tmp scratch; main fleet's shared cargo cache (167G) was emptied concurrently (not by us). Now 337G free. Both workers told to re-run any disk-failed cargo tests. Bulletin updated. Added a disk-pressure alarm (<25G) to the watchdog.
- w0: Task 1 (Graph draft creation) in progress, waiting on cargo test. w1: Tasks 2–7 in progress (calendar model/store/OAuth/Graph/Google), was blocked on disk during cargo test → unblocked.

## UPDATE 2026-07-02 — execution started
- Coordinator: Fable (this main session, at Jameson's direction). Workers: Sonnet 5 default, Opus 4.8 only for correctness-critical with stated reason. NEVER Fable workers.
- Downstream merge origin/keepance-3.0 (000060cf → 7656f6c3, 29 commits, clean no-conflict) DONE locally; gate in progress (tsc ✅; vitest + cold cargo on CARGO_TARGET_DIR=~/.cargo-target-lantern-plus running). DO NOT PUSH lantern-plus until cargo green.
- Lanes: lp/wave-0 (worktree ~/lp-w0, worker cc-lantern-w0) = Wave 0 story assembly. lp/wave-1 (worktree ~/lp-w1, worker cc-lantern-w1) = Wave 1 Rust calendar tasks 2–7 only (disjoint from Wave 0 files; UI tasks wait for Wave 0 merge order).
- Merge order: Wave 0 first, then Wave 1 batches. One merge in flight; coordinator merges only.
- CARGO RULE: all lantern-plus sessions export CARGO_TARGET_DIR=~/.cargo-target-lantern-plus; one cargo at a time WITHIN this effort; never touch the main fleet's shared target.
- NEEDS JAMESON (parked): (1) file the vendor API applications (Redtail/Salesforce/DocuSign — Wave 0 produces the checklist doc, the filings need him); (2) Google OAuth calendar-scope verification application (Wave 1 Task 1 — worker prepares the submission pack, Jameson files); (3) fire the discovery-interview campaign.
- Legion: not needed until Wave 3; main line holds it (bulletin).
