ROLE: Test-tooling worker, round 2 on the bench-smoke harness (scripts/bench-smoke.mjs + scripts/bench-smoke/ — merged tonight @60bdb0e4, live-validated 6/8 on the Legion). You close its documented follow-ups and implement the checks for the ALREADY-MERGED Wave-4 B/C features, so the imminent Wave-3/4 bench verification runs scripted instead of manual.

WORKDIR: ~/lp-harness2 (git worktree, branch lp/harness-round2 off current origin/lantern-plus tip — pull first). NOT self-merged.

READ FIRST: docs/qa/BENCH-SMOKE-HARNESS.md + scripts/bench-smoke/ (the whole module — reuse its Driver/check/result conventions exactly) + the prior lane's handoff notes in git log for lp/bench-smoke-harness merges + docs/evidence/windows-smoke-2/RUN-LOG.md (the Wave-4 UI evidence section shows what was manually verified).

SCOPE (all additive to the harness; no product-code changes):
1. Build the Settings/Connections NAVIGATION HELPER the prior lane documented as the blocker for two checks, then un-block: `wave1-calendar-brief-export` and `egress-indicator` (both currently SETUP-BLOCKED by design).
2. Fix the documented FLAKY `index-health` check (passed once, blocked once) — find the nondeterminism (timing? state?) and make it deterministic or honestly classified.
3. Implement the Wave-4 B/C checks against the MERGED features (find selectors in the merged code): Book view renders with ranked client rows (whole-book segment in Client Map tab); a book row opens the client hub; estate/beneficiary mismatch chips render (and dismissal works) where fixture data provides them; whole-practice Ask scope pill renders; consent gate appears when required (Local-only mode nuances — read the merged Track C code for the gating conditions). Read-only assertions; anything that would mutate advisor-visible state goes behind the existing --live flag.
4. Wave-3 + Wave-4 A/D checks STAY STUBS (those lanes haven't merged) — but update stub TODOs with the acceptance items from their briefs if trivially available.
5. Unit tests per the module's existing pattern (fake-DOM vm tests where scripts are generated; parser/logic tests otherwise).

CONSTRAINTS: additive only; do not modify desktop-drive.mjs or product code. DO NOT connect to any bench without asking (the Legion is reserved for the Wave-3 lane's device verification next — you'll likely validate live AFTER that; build + offline-verify everything first, exactly like round 1 did).

RULES: COORDINATION MODE (plain-text COORDINATOR: decisions, no menus). TDD on logic. Self-converge via codex-review to one clean round. Evidence handoff: HEAD SHA, checks added/unblocked, test counts, what awaits live validation, "NOT self-merged". THEN print your done sentinel for lp/harness-round2 as the very last line in the standard worker format.
