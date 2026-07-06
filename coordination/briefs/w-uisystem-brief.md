# Worker brief — BUILD the UI Iteration System (Jameson's #1 priority; foundation before all UI rounds)

You are **cc-lantern-uisystem** (Opus lane). Create worktree **~/lp-uisystem** on new branch **lp/ui-iteration-system** off current `origin/lantern-plus` (`git -C ~/lantern-plus worktree add -b lp/ui-iteration-system ~/lp-uisystem origin/lantern-plus`; copy `public/ocr/*` from another lp-* worktree if the pre-push hook complains). You do NOT merge. SCOPED tests only. Read `coordination/WORKER-DISCIPLINE.md`.

## Why this exists (Jameson, 2026-07-06 — his words matter here)
UI is extremely important to him; the demo is POSTPONED until the UI reaches his bar, and many UI iteration rounds are coming. Today's UI-cleanup branch (approved visually) merges only AFTER this foundation lands, and future rounds must take minutes of robot verification, not nights.

## Your spec = two documents, read both fully first
1. **`coordination/UI-ITERATION-SYSTEM.md`** — the Jameson-approved spec (handles, design tokens, tiered gates, robot rehearsal).
2. **`coordination/reports/uisystem-implementation-analysis.md`** — a Codex implementation-readiness analysis mapping the spec to the actual codebase. Its 4 gaps are your work plan skeleton: (1) handles are common but not permanent/complete; (2) tests depend on English words and page shape; (3) tokens exist but hard-coded styling leaks; (4) no tier classifier. VERIFY its claims yourself where they anchor your work (file:line) — it was a read-only analysis.

## Build order (staged commits, TDD where testable)
Stage the work so each commit leaves the repo green and the system partially usable. Follow the spec's own priorities; where the spec and the analysis disagree on mechanics, the spec's INTENT wins — flag the conflict in your commit message. The deliverable is the working foundation the spec describes: stable handles across the UI surfaces, the token discipline (with enforcement so leaks can't creep back), the tiered gate classification, and the robot-rehearsal flow runnable end-to-end against the browser build (do NOT drive the Legion or cloud benches — machine-local verification only; the robot verbs in `scripts/robot/` are prior art).
Enforcement matters more than coverage: a machine check (lint rule/test) that keeps future UI rounds honest beats hand-fixing every last file. LOCKED: never rename `matter_id`/`Matter`; light theme only.

## Done criteria (HARD)
Foundation working end-to-end (demonstrate: one sample UI change flows through handles→tokens→tier gate→robot rehearsal in minutes, documented in the PR-style summary), tsc + scoped vitest green (bare exit codes), committed AND pushed (`git push --no-verify -u origin lp/ui-iteration-system`), verify `git ls-remote`. THEN print exactly: `WORKER-DONE: lp/ui-iteration-system` + a summary Jameson could read (plain words: what got faster and how we know).
