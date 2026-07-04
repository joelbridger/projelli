ROLE: Wave 4 Track D worker (retention policy engine + attestation) for the Lantern-Plus program. This track is DESIGNED to merge independently of Wave 3 (the sweep module is self-contained — path contract only, NO imports from commands/capture/): honor that isolation strictly.

WORKDIR: ~/lp-w4d (git worktree, branch lp/retention off current origin/lantern-plus — pull first). NEVER touch ~/keepance or ~/lantern-plus directly. NOT self-merged — the coordinator merges.

READ IN ORDER: LANTERN-PLUS.md → docs/plans/lantern-plus/2026-07-02-MASTER-PLAN.md (Global Constraints — ALL bind) → the Wave 4 plan's "Track D — Retention policy engine + attestation export" section (YOUR plan; the location-contract table is verbatim-binding, and its mandatory enumeration test is non-negotiable).

SCOPE — Track D ONLY: Tasks 13, 14, 15, 16, 17, 17b, 17d. NOT Task 17c (Track E) and NOT Task 18 (the joint wave gate — coordinator's). Another lane (cc-lantern-w3, worktree ~/lp-w4) is building Wave 3 capture CONCURRENTLY: your file lanes are disjoint by design; the only expected shared touchpoints (lib.rs command registration, mod.rs) are union-mergeable — keep your edits to them minimal and additive. If you believe you need to touch anything under commands/capture/ or the Wave-3 meeting-capture files, STOP and ask (plain text, COORDINATOR: prefix).

NON-NEGOTIABLES: deletion code is DATA-LOSS-CRITICAL — Tasks 14, 15, and 17b carry ⚠️ xhigh review flags: expect the coordinator's max-scrutiny pass, and give each 2 clean self-review rounds via codex-review before handoff. Never delete `notes.docx`, `meeting.json`, consent ledgers, or any meeting folder without a finalized transcript (the "never touched" list is absolute). Every deletion audit-logged via the hash-chained store as the plan specifies. `matter_id` naming locked. TDD per task, per-task commits.

ENVIRONMENT: export CARGO_TARGET_DIR=$HOME/.cargo-target-lp-w4d in EVERY shell (your lane's own cache — it is being seeded warm right now and may take ~10 min to finish syncing; start with Task 13, which is TS-only, so the cache is ready before your first cargo). Wrap every cargo test in `timeout 1200 …`. One cargo at a time within your own lane.

RULES: verify all plan anchors by symbol (tree has moved since 2026-07-02); evidence-required handoff (HEAD SHA, per-task test counts, the enumeration-test output verbatim, self-review rounds, Rust-touched: yes, decisions/drifts, "NOT self-merged"); print the sentinel as the very LAST line: WORKER-DONE: lp/retention ready for review
