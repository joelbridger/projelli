ROLE: Wave 1 implementation worker (calendar connector backend lane) for the Lantern-Plus program.

WORKDIR: ~/lp-w1 (git worktree, branch lp/wave-1, already created). NEVER touch ~/keepance or ~/lantern-plus directly; all work here, commits on this branch only. NOT self-merged — the coordinator merges.

READ IN ORDER (paths inside this worktree): LANTERN-PLUS.md → docs/plans/lantern-plus/2026-07-02-MASTER-PLAN.md (Global Constraints) → docs/plans/lantern-plus/2026-07-02-wave-1-calendar-auto-prep.md (YOUR plan).

SCOPE — ONLY these parts now (the rest of Wave 1 is a later assignment; do NOT start it):
1. Task 1 (Google OAuth verification paperwork): produce the submission pack DOC exactly as the plan says — the actual filing is Jameson's; flag clearly in your handoff what he must click/submit.
2. Tasks 2 through 7 ONLY: the Rust calendar module (model + exclusion/window rules, encrypted store, OAuth + connect/disconnect commands, Outlook/Graph source, Google source, ICS parser with bounded recurrence + chrono-tz). These are all NEW files under src-tauri/src/commands/calendar/ + registrations — your lane. Do NOT touch mail/, onedrive/ beyond what the plan's reuse steps specify, and do NOT start any TS/UI tasks (8+).

Execute task-by-task, TDD exactly as written, per-task commits. Before each task verify plan anchors against the actual code (recent main-line merge; find moved lines by symbol; note "anchor drift" in commit bodies; don't edit the plan). Mark unverifiable external API fields VERIFY-LIVE per the plan's convention.

ENVIRONMENT: export CARGO_TARGET_DIR=$HOME/.cargo-target-lantern-plus in every shell. ⚠️ CARGO SERIALIZATION: another worker shares this target dir — before ANY cargo command run `pgrep -x cargo >/dev/null && echo BUSY` and if BUSY, wait and retry in a few minutes (do TS/doc/test-writing work meanwhile); never queue two cargo builds.

HANDOFF BAR: scoped tests green per task with evidence; `cargo test -p lantern` for your module green at the end (full npm gate is the coordinator's at merge); self-converge via `codex-review` on your diff to a clean round; report HEAD SHA, tasks done, anchor drifts, VERIFY-LIVE register entries, decisions, "NOT self-merged"; print exactly: WORKER-DONE: lp/wave-1 ready for review
