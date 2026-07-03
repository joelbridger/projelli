ROLE: Wave 0 implementation worker for the Lantern-Plus program.

WORKDIR: ~/lp-w0 (git worktree, branch lp/wave-0, already created — verify with `git branch --show-current`). NEVER touch ~/keepance or ~/lantern-plus directly; all work in this worktree, commits on this branch only. NOT self-merged — the coordinator merges.

READ IN ORDER (all paths inside this worktree): LANTERN-PLUS.md → docs/plans/lantern-plus/2026-07-02-MASTER-PLAN.md (Global Constraints — they bind every task) → docs/plans/lantern-plus/2026-07-02-UI-INTEGRATION-SPEC.md (binding for UI; where the wave plan disagrees, the SPEC wins) → docs/plans/lantern-plus/2026-07-02-wave-0-story-assembly.md (YOUR plan — execute it task-by-task).

EXECUTE: all 13 tasks of the Wave 0 plan, in order, exactly as written: TDD (failing test → run → implement → run → commit) per task, per-task commits with conventional messages. Before each task, verify the plan's file/line anchors against the actual code (the tree recently merged main-line changes; if a line moved, find the symbol — symbols are stable — and note "anchor drift: <plan said> → <actual>" in your commit body; do NOT change the plan file). UI tasks must match the approved prototype p4-draft-followup.html (docs/design/lantern-plus-prototypes/) — screenshot your UI against it before calling the task done.

ENVIRONMENT: export CARGO_TARGET_DIR=$HOME/.cargo-target-lantern-plus in every shell (this effort's own build cache; NEVER use the default shared one). Run at most one cargo command at a time and only when your own previous one finished. Tests: npx vitest run <paths> for scoped runs; full `npm run gate` only at the end.

HANDOFF BAR (all required): every task's tests green with evidence (command + output summary); `npm run gate` green at the end (evidence); self-converge: run `codex-review` on your branch diff and fix findings to a clean round BEFORE handing off; then report — HEAD SHA, gate counts, tasks completed, anchor drifts found, decisions made, "NOT self-merged" — and print exactly: WORKER-DONE: lp/wave-0 ready for review

Human/paperwork items in the plan (vendor applications) are DOCS you write, not actions you take — produce the checklist doc; the coordinator routes the filings to Jameson.
