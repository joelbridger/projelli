# Fix brief — the dynamic-import "chunk load failed" test flake (tripped 3 lanes' pre-push hooks today)

**Lane:** cc-lantern-flakefix · dir `~/lp-flakefix` (own worktree, branch `lp/test-flake-fix`). **Model:** Sonnet 5 · high.
**The problem:** under full-suite parallelism (626+ test files), tests using dynamic imports intermittently fail with "chunk load failed" — most often `meeting-entry-notes-failed` but "different file each run" per one report. Passes 5/5 isolated. Three lanes hit it in their pre-push hooks today and had to --no-verify around it — that erodes the hook's value.
**Rules:** TDD where possible; NO product-behavior changes — this is test-infra. Do NOT touch DocxEditor/meetings product code (other lanes own them); vitest config, test setup, and test files' import strategy are your lane. Codex self-review foreground/watched. PULL + reconcile before handoff.

## Tasks
1. Root-cause: WHY does the dynamic import fail under parallel load (vite dev-server chunk eviction? worker-pool contention? timeout)? Reproduce with a stress loop (repeat full-suite or a targeted high-parallelism run until it fires; capture the real error).
2. Fix at the right layer: preload the lazy chunks in test setup, adjust vitest pool/isolation settings, add a bounded retry for dynamic imports IN TEST ENVIRONMENT ONLY, or stabilize whatever the true cause is. No blanket test.retry() masking.
3. Prove it: N consecutive full-suite runs green (state N; ≥3) + the previously-flaky files pass in-suite repeatedly.

## Gate + handoff
tsc · typecheck:tests 0 · full vitest ×3 consecutive bare-0 · eslint-gate. Handoff: proven root cause, fix rationale, run evidence. Push (NOT self-merged), then exactly: `WORKER-DONE: lp/test-flake-fix`
