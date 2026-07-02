ROLE: Wave 2 implementation worker (CRM write-back backend lane) for the Lantern-Plus program.

WORKDIR: ~/lp-w2 (git worktree, branch lp/crm-writeback, already created — verify with `git branch --show-current`). NEVER touch ~/keepance or ~/lantern-plus directly; all work in this worktree, commits on this branch only. NOT self-merged — the coordinator merges.

READ IN ORDER (paths inside this worktree): LANTERN-PLUS.md → docs/plans/lantern-plus/2026-07-02-MASTER-PLAN.md (Global Constraints — they bind every task) → docs/plans/lantern-plus/2026-07-02-wave-2-crm-writeback.md (YOUR plan).

SCOPE — ONLY these parts now (the rest of Wave 2 is a later assignment; do NOT start it):
Tasks 1 through 7 ONLY: the Rust CRM write module — write models/error taxonomy/dedup key, WealthboxClient::post_json, CrmWriteSource trait + Wealthbox impl, outbound-write ledger in CrmStore, push_crm_write orchestrator (idempotency + ambiguous-failure recovery), Tauri commands + audit + registration, content-safety/injection tests. Your lane = `src-tauri/src/commands/crm/` + the lib.rs command registration block. Do NOT touch `src-tauri/src/commands/calendar/` (another lane owns it), do NOT touch mail/, and do NOT start any TS/UI tasks (8+).

Execute task-by-task, TDD exactly as written (failing test → run → implement → run → commit), per-task commits with conventional messages. Before each task verify the plan's file/line anchors against the actual code (the tree moves with main-line merges; find moved lines by symbol — symbols are stable; note "anchor drift: <plan said> → <actual>" in commit bodies; don't edit the plan). Mark unverifiable external API fields VERIFY-LIVE per the plan's convention — the plan already has a VERIFY-LIVE register; extend it in code comments, never guess-and-assert.

PII RULE (binding, from the plan): raw HTTP response bodies NEVER appear in logs or error strings — status code + endpoint path only. Writes are approval-gated: no code path may POST to the CRM except via the explicit command the user approved.

ENVIRONMENT: export CARGO_TARGET_DIR=$HOME/.cargo-target-lantern-plus in every shell (this effort's own build cache; NEVER the default shared one). ⚠️ CARGO SERIALIZATION: other workers share this target dir — before ANY cargo command run `pgrep -x cargo >/dev/null && echo BUSY` and if BUSY, wait and retry in a few minutes (do test-writing/doc work meanwhile); never queue two cargo builds.

HANDOFF BAR (all required): scoped tests green per task with evidence (command + output summary); `cargo test -p lantern` for your module green at the end (full npm gate is the coordinator's at merge); self-converge: run `codex-review` on your branch diff and fix findings to a clean round BEFORE handing off; then report — HEAD SHA, tasks completed, anchor drifts found, VERIFY-LIVE register entries, decisions made, "NOT self-merged" — and print exactly: WORKER-DONE: lp/crm-writeback ready for review
