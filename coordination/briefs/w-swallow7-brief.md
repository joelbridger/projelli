# Worker brief — swallow-p0 ROUND 7 (BUILD-ONLY during demo freeze)

You are **cc-lantern-swallow7**, working in the EXISTING worktree **~/lp-swallowp0** (branch lp/swallow-p0). Judgment-heavy reconciliation lane. You do NOT merge. 🧊 **TIP FREEZE IS ON: this branch will NOT merge until after the demo rehearsal — get it merge-READY, push, stop.**

## Your spec = two documents, read both fully first
1. **`coordination/reports/swallow-p0-close-verdict.md`** (on this branch @1d5b6e2a) — the Fable close-out verdict: merge-ready AFTER these fixes, no redesign. Its R7 items are your work list.
2. **Codex second opinion:** `/tmp/claude-1000/-home-jameson-lantern-plus/cbf813e9-0636-4dab-94c6-c1621a39686c/scratchpad/codex-swallowp0.log` (4 findings, largely concurring — the verdict doc already reconciles them).

## The two BLOCKING items (judgment work, not mechanical)
1. **Rebase onto current origin/lantern-plus** (63+ commits ahead; conflicts in useMemoryWiring.ts ~892-980/~1340/~2045 + MemoryService.ts:448) resolving the TWO SEMANTIC collisions correctly:
   - Workspace-identity guard early-`return`s must NEVER read as success that clears a fail-closed hold: identity-abort becomes a distinct outcome (sentinel throw or disposal check) that keeps the hold.
   - Rebuild `retagFolderPathsInPlace` on the new per-path-misses `retagMatterBatch` API: returned misses → re-index those paths (NOT failures); thrown errors / failed re-indexes → the hold. Do not over-exclude never-indexed files; do not drop real failures.
2. **The remaining verdict items** (hydration fail-closed on corrupt pending-store, workspace-explicit/generation-checked mail retag command, etc. — the verdict doc ranks them; do all it marks required).

## Method
Strict TDD per item (the verdict doc names the failure scenarios — turn each into a test first). Rust touched ⇒ `cargo test` scoped to your areas; TS ⇒ tsc + scoped vitest. The branch has 51 passing tests + 1 documenting expected-fail — that expected-fail should flip to a passing fix test.

## Done criteria (HARD)
All required verdict items done with red→green evidence, branch rebased clean on origin/lantern-plus, committed AND pushed. THEN print exactly: `WORKER-DONE: lp/swallow-p0 round7` + per-item summary. The branch then WAITS for the post-demo merge window (fresh coordinator review + full gate at merge).
