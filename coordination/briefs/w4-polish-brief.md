ROLE: Polish-lane worker (P0/P1 follow-ups on merged Wave 0/1 surfaces) for the Lantern-Plus program.

WORKDIR: ~/lp-w4 (git worktree, branch lp/polish-1 off the current lantern-plus tip, already created). NEVER touch ~/keepance or ~/lantern-plus directly. NOT self-merged — the coordinator merges.

READ IN ORDER: LANTERN-PLUS.md → docs/plans/lantern-plus/2026-07-02-MASTER-PLAN.md (Global Constraints) → docs/plans/lantern-plus/2026-07-02-UI-INTEGRATION-SPEC.md + the approved prototypes (items 1-2 are UI-fidelity work — the prototype IS the spec).

SCOPE — four follow-ups, in this order:
1. [P0, UI] Citation-chip hover popovers in the Wave-0 DraftFollowUpModal — the approved prototype p4-draft-followup.html shows inline citation chips with hover previews; the shipped modal lacks them. Match the prototype.
2. [P0, UI+prompt] Per-bullet citations in the before-you-meet brief (Task 17's deferred richer version) — prototype p2-before-you-meet.html shows each brief bullet with its own citation chip + hover preview. This needs the brief generation to emit structured per-bullet-attributed output (see generateBrief.ts + the Workflows template it uses). If after investigation you judge this genuinely infeasible without a model-contract change, STOP on this item, write up why + options, and continue with 3-4.
3. [P2, Rust] Calendar disconnect must not report success when the RAG purge fails (src-tauri/src/commands/calendar/commands.rs ~290): if the vector-store delete fails (LanceDB unavailable, key read failure), the credential/rows are still deleted and success is reported, leaving disconnected-calendar content searchable with no retry path. Surface/abort on purge failure, or tombstone + durable retry BEFORE removing the credential. Privacy behavior — TDD it thoroughly.
4. [P2, Rust] Outlook attendee mapping does not filter the advisor's own address the way Google's does (calendar graph_source vs google_source) — bring Outlook to parity.

RULES: TDD, per-task commits; UI acceptance = matches the prototype (screenshots to docs/evidence/polish-1/ + click-counts); export CARGO_TARGET_DIR=$HOME/.cargo-target-lp-w4 (seed is pre-arranged by the coordinator — do NOT run cargo until the coordinator's message confirms the cache is ready; TS items 1-2 first, they need no cargo); wrap every cargo test in `timeout 1200 …`; self-converge via codex-review to a clean round; run the FULL vitest suite before handoff (not just scoped tests); evidence handoff; sentinel as the very LAST line: WORKER-DONE: lp/polish-1 ready for review
