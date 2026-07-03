ROLE: Test-tooling worker. Build a REPEATABLE SCRIPTED SMOKE HARNESS that automates the manual Windows bench smoke we have now run twice by hand (docs/evidence/windows-smoke-2/RUN-LOG.md is the checklist source). Goal: every future bench pass (Wave 3, Wave 4, final integration re-verify) drops from hours of manual driving to a scripted run + human review of evidence.

WORKDIR: ~/lp-smokeharness (git worktree, branch lp/bench-smoke-harness off current origin/lantern-plus tip — pull first). NOT self-merged.

READ FIRST: scripts/desktop-drive.mjs (the CDP driving primitives — REUSE by import, never fork/copy its logic) + scripts/legion-drive.sh (tunnel pattern) + `git show origin/lp/windows-smoke-evidence:docs/evidence/windows-smoke-2/RUN-LOG.md` (the smoke steps you are automating) + scripts/nightly-bench-tests.sh (conventions: parse OUTPUT not exit codes over Windows SSH; never wrap remote builds in short timeouts).

DELIVERABLE: `scripts/bench-smoke.mjs` (+ small helper modules under scripts/bench-smoke/ if needed) + `docs/qa/BENCH-SMOKE-HARNESS.md` (how to run, what it covers, how to add wave checks):
- Runs FROM THE SERVER against the bench over CDP (port 9223, tunnel per legion-drive.sh pattern). Bench hostname/target parameterized (the Azure cloud bench will be a second target).
- Structured as CHECKS mapped 1:1 to the smoke-2 checklist sections (workspace binding, per-client files visible, index health, Wave-0 draft-follow-up flow, Wave-1 calendar→brief→export, Wave-2 send-to-Wealthbox queue→review card). Each check = navigate/act via CDP, assert observable UI state + console-error cleanliness, capture a screenshot into an evidence dir with a pass/fail JSON summary.
- SAFETY DEFAULT: read-only/queue-only — the Wealthbox check stops at the review card (verifies the queued card renders); NO approve/send, NO OAuth flows, NO destructive ops unless a --live flag is passed (document it as sandbox-only). The harness must be safe to run against a bench whose connections are already set up.
- Wave-3/4 checks: add STUBS (clearly marked TODO with the acceptance items from the wave plans) — the wave lanes' bench verification will fill them in.
- Resilient to timing (explicit waits on selectors, not sleeps) and honest about failure (a check that can't find its precondition reports SETUP-BLOCKED, distinct from FAIL).

CONSTRAINTS: ADDITIVE ONLY — new files; do not modify desktop-drive.mjs, product code, or any other lane's files. TS/JS only, no Rust. Test what you can without the bench: node --check, dry-run mode (--plan prints the check list), unit-test the assertion/summary logic with vitest. DO NOT CONNECT TO THE LEGION without asking — it is owned by the bench-prep lane right now, then Wave-3 device verification; ask "COORDINATOR: harness ready for a live validation run — may I have the bench?" when you need it, and build everything else first.

RULES: COORDINATION MODE (no interactive menus). TDD on the logic parts; self-converge via codex-review to a clean round. Evidence handoff: HEAD SHA, files added, what was validated offline vs what awaits a live run, "NOT self-merged". THEN last line: WORKER-DONE: lp/bench-smoke-harness ready for review
