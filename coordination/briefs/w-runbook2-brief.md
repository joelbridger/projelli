# Worker brief — apply the 10 runbook review edits

You are **cc-lantern-runbook2**, worktree **~/lp-runbook2**, branch **lp/runbook-edits** (off tip 7f0295af). Docs-only lane; push with `--no-verify`. You do NOT merge.

## Task
Apply the 10 ranked edits from the adversarial review at `/tmp/claude-1000/-home-jameson-lantern-plus/cbf813e9-0636-4dab-94c6-c1621a39686c/scratchpad/codex-runbook.log` (read the last ~4.5KB) to `docs/demo/DEMO-RUNBOOK.md`. Keep the existing voice: plain language for a non-engineer presenter, short sentences, everyday analogies, no jargon/file paths in presenter-facing lines.

## Corrections to the review's own assumptions (use these as ground truth)
- Edit #3: the progress banner IS now verified on real Windows twice (bench-1 rehearsal saw "Indexing PDFs: 6/6. Nothing leaves your machine." live). Keep a concrete example but phrase it as "a message like…", and keep the advice to point at whatever is actually on screen.
- Edit #5: the 13→53 client jump was a real, observed Wealthbox import on a test machine. The edit still stands: only mention counts if the audience watches them change live.
- Edit #6 (sidebar tidy) is already queued from another finding — make sure it lands as a checklist item: "the client sidebar must show ONLY the three demo families before you start."

## Done criteria (HARD)
All 10 edits applied (with the corrections above), doc still reads smoothly start-to-finish, committed AND pushed (`git push --no-verify -u origin lp/runbook-edits`). THEN print exactly: `WORKER-DONE: lp/runbook-edits` + 2-line summary.
