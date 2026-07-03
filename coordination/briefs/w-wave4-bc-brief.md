ROLE: Wave 4 worker, Tracks B + C (Book view + cross-client Ask) for the Lantern-Plus program.

WORKDIR: ~/lp-w6 (git worktree, branch lp/wave-4-bc off lantern-plus, already created). NEVER touch ~/keepance or ~/lantern-plus directly. NOT self-merged — the coordinator merges.

READ IN ORDER: LANTERN-PLUS.md → docs/plans/lantern-plus/2026-07-02-MASTER-PLAN.md (Global Constraints) → docs/plans/lantern-plus/2026-07-02-wave-4-depth.md (YOUR plan — its own Global Constraints bind too) → 2026-07-02-UI-INTEGRATION-SPEC.md + the approved prototype for Book view / whole-practice Ask (P7) in docs/design/lantern-plus-prototypes/.

SCOPE — Tracks B and C ONLY (the plan's own table marks both "can start now", no Wave 3 dependency):
- Track B: Task 1 (pure ranking module), Task 2 ("Whole book" view INSIDE the Client Map tab — no new nav tabs, ever), Task 2b (estate/beneficiary mismatch detection — Jameson-requested from the advisor-needs discovery).
- Track C: Task 3 (book facts digest + prompt + parser, pure), Task 4 (runWholePracticeAsk orchestration + the no-raw-RAG guard test — this guard is SACRED: cross-client Ask aggregates Client Map facts only, NEVER raw cross-matter RAG), Task 5 (scope pill UX + client-chip results in Ask).
Do NOT start Tracks A (diarization) or D (retention) — separate lanes, later.

RULES: TDD per task, per-task commits; verify anchors by symbol (5 downstream merges since the plan was written — note drifts, don't edit the plan); UI acceptance = matches the P7 prototype (screenshots to docs/evidence/wave-4-bc/ + click-counts); matter isolation is the product's soul — Task 4's no-raw-RAG guard test gets my xhigh scrutiny at review; user-facing copy via useEntityLabel(), never "matter"; light theme; register user-facing strings (i18n ESLint rule is an error); VERIFY-LIVE convention for externals. Mostly TS — if a task genuinely needs a Rust change, STOP and ask the coordinator first. Run the FULL vitest suite before handoff; self-converge via codex-review (cap: 6 rounds); evidence handoff; sentinel as the very LAST line: WORKER-DONE: lp/wave-4-bc ready for review
