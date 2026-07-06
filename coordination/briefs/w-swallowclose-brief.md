# Worker brief — swallow-p0 comprehensive close (VERDICT ONLY, no merge)

You are **cc-lantern-swallowclose**, a **Fable** worker (allowed per Jameson 2026-07-04 for judgment-heavy lanes). Work in the EXISTING worktree **~/lp-swallowp0** (branch lp/swallow-p0 — do NOT create a new one; do not rebase or push without being told). You do NOT merge. Your deliverable is a VERDICT DOCUMENT, not code (small test additions are allowed if they prove/disprove a hole).

## Context
lp/swallow-p0 is 6 rounds deep on a rare P0-class privilege leak: mail-folder-remap could leak excluded mail across sessions; the branch builds durable per-workspace mail exclusion. It was PARKED (off the demo path) awaiting exactly this: a comprehensive, fresh-eyes close-out by a top-tier reviewer. A Codex adversarial review is running in parallel (`/tmp/claude-1000/-home-jameson-lantern-plus/cbf813e9-0636-4dab-94c6-c1621a39686c/scratchpad/codex-swallowp0.log` — read it when it exists, weigh it as a second opinion, not gospel).

## Your job
1. Understand the bug's full history: the branch's commits, `coordination/qa-campaign/BUG-DB.md`'s swallow entries, and round-by-round context in the branch's own docs/commit messages.
2. Map the exclusion lifecycle end-to-end (create, persist, restore, workspace switch, folder remap/rename, concurrent sync, corruption/absence of the persistence file) and verify each transition is safe BY READING THE CODE — and where genuinely uncertain, write a small targeted test in the worktree to prove/disprove (scoped `cargo test`/vitest only).
3. Check semantic compatibility with this week's merged RAG work (row-verified reconcile, per-path retag, `src-tauri/src/commands/rag/`) and the useMemoryWiring changes.
4. Deliver `coordination/reports/swallow-p0-close-verdict.md` with: VERDICT (merge-ready as-is / merge-ready after listed fixes / needs redesign), the precise list of remaining holes if any (file:line + failure scenario), what round 7 should do (or that none is needed), and your confidence. Commit + push THE REPORT to the lp/swallow-p0 branch (report + any test additions only).

## Done criteria (HARD)
Report pushed. THEN print exactly: `WORKER-DONE: swallow-p0-verdict` + the one-line verdict.
