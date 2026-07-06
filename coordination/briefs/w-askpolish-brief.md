# Worker brief — Ask verification-timing polish (2 findings from cross-branch review)

You are **cc-lantern-askpolish**, worktree **~/lp-askpolish**, branch **lp/ask-verify-timing** (off tip 284bcfeb). Small scoped frontend lane. You do NOT merge. SCOPED tests only (never the full suite); push with --no-verify.

## Context
Full findings: `/tmp/claude-1000/-home-jameson-lantern-plus/cbf813e9-0636-4dab-94c6-c1621a39686c/scratchpad/codex-crossbranch.log` (last ~6KB). Two timing gaps between tonight's merged Ask changes:

## Fix 1 (MEDIUM): negative citation verdicts during active indexing must not stick
`src/features/ask/SourcePanel.tsx:65-67` — verification results are keyed by id+matterId+excerpt and never retried. If the verifier runs while boot repair/re-indexing is still in flight (QA-92's reconcile), a real source can return notFound/matterMismatch and then stay falsely red forever (until remount). Fix: when a verdict is negative AND file indexing is active (the same signal useStillImporting reads), treat it as pending and retry once indexing completes (listen for the indexing-done progress event). Never let a negative verdict from an indexing window become permanent.

## Fix 2 (LOW): still-importing starts as false, not unknown
`src/features/ask/useStillImporting.ts:24,33` — the hook returns false during its initial async status fetch, so a question asked instantly after opening Ask can get a generic "nothing found" instead of the honest still-importing decline (`useAsk.ts:781`). Fix: tri-state `unknown | importing | idle`; `unknown` + zero hits → the "still checking your files" decline (or hold briefly until known). Keep the existing behavior once idle is confirmed.

## Method
TDD (Vitest): (a) negative verdict while indexing → stays pending → retries and turns green after indexing-done; (b) negative verdict while idle → sticks (current behavior); (c) zero hits with status unknown → honest decline, not generic no-results. Scoped diff to SourcePanel.tsx + useStillImporting.ts + the retry wiring. No `matter_id`/`Matter` renames.

## Done criteria (HARD)
tsc green + scoped vitest green, committed AND pushed, THEN print exactly: `WORKER-DONE: lp/ask-verify-timing` + 3-line summary.
