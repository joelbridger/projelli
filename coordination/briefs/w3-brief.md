ROLE: Wave 2 UI-lane worker (CRM write-back approval surface) for the Lantern-Plus program.

WORKDIR: ~/lp-w3 (git worktree, branch lp/crm-ui, already created — verify with `git branch --show-current`). NEVER touch ~/keepance or ~/lantern-plus directly. NOT self-merged — the coordinator merges.

FIRST ACTION (before any code): `git fetch origin && git merge origin/lantern-plus` into your branch (it's stacked on lp/crm-writeback, which pre-dates the Wave 0+1 merges — absorb them first; resolve conflicts in favor of origin/lantern-plus for files outside the crm lane).

READ IN ORDER: LANTERN-PLUS.md → docs/plans/lantern-plus/2026-07-02-MASTER-PLAN.md (Global Constraints) → docs/plans/lantern-plus/2026-07-02-UI-INTEGRATION-SPEC.md (BINDING for your UI) → docs/plans/lantern-plus/2026-07-02-wave-2-crm-writeback.md (YOUR plan) → the approved prototypes in docs/design/lantern-plus-prototypes/ (your plan names which).

SCOPE — Tasks 8 and 9 ONLY (both pure TypeScript; you need NO cargo, ever — if you think you need a Rust change, stop and ask the coordinator):
- Task 8: TS command wrappers (crmCreateNote/crmCreateTask in src/platform/utils/wealthbox-commands.ts) + buildInverseCrmMap in src/platform/rag/matterResolver.ts.
- Task 9: crmWriteQueueStore (Zustand) + CrmWriteReviewCard.tsx mounted in ClientMapPanel beside ClientMapUpdatesTray + the MatterNotesEditor "Send to Wealthbox" enqueue action.
Do NOT start tasks 9b/9c/10/11 (later assignment). The Rust command layer exists on your branch (built by another worker) — write wrappers against the actual #[tauri::command] signatures you find in src-tauri/src/commands/crm/; if a signature differs from the plan, match the CODE and note the drift.

RULES: TDD per task, per-task commits; UI acceptance = matches the prototype (screenshot to docs/evidence/wave-2-ui/ in your worktree + click-counts in your handoff); writes are approval-gated — the card's Approve button is the ONLY thing that may trigger a CRM push; light theme; user-facing copy says client/household, never matter. Self-converge with codex-review to a clean round before handoff. Report evidence (HEAD SHA, test counts, screenshots list, drifts, decisions, "NOT self-merged") and print the sentinel as the very LAST line: WORKER-DONE: lp/crm-ui ready for review
