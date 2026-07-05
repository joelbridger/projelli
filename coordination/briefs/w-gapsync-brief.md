# Worker brief — Wave-4 estate/beneficiary gap: book view vs client detail out of sync

**Lane:** cc-lantern-gapsync · worktree `~/lp-gapsync` · branch `lp/wave4-gap-sync`
**Model:** Sonnet 5 · high. TS-only expected (no cargo unless the data truly comes from Rust — verify first).

## The bug (found by the finish-line bench pass on real Windows)
The Client Map "Whole book" view renders an estate/beneficiary gap chip for Caldwell, Jennifer — but opening HER client detail view shows no corresponding resolvable gap control. Book-level and per-client views disagree. Repro + screenshots: `docs/evidence/` on branch `lp/windows-smoke-evidence` (see the newest RUN-LOG.md section, 2026-07-04 full pass) — read that FIRST.

## Approach (diagnosing-bugs + tdd skills apply)
1. Read the RUN-LOG evidence, then find both code paths: the book-view gap-chip derivation and the client-detail gap control (grep for the estate/beneficiary gap feature from Wave 4 Track B — `lp/wave-4-bc` work, likely under `src/features/matters/` book/client-map code).
2. Root-cause WHY they disagree (different data source? different threshold/filter? detail view requiring a doc the book view doesn't? state staleness?). NO SHORTCUTS — fix the actual divergence (single source of truth for "this client has gap X and it is resolvable"), not a cosmetic patch on one view.
3. Red-first: a failing test that captures the disagreement (same fixture → both views must agree), then fix, then green. Extend the existing Wave-4 book-view tests and the new bench-mirror Playwright specs if they cover this surface (`tests/e2e/bench-mirror-book-view.spec.ts` — check whether the mirror can now catch this class; if the bug reproduces in the browser mirror, ADD the regression spec there too — that proves the mirror's value).
4. Gate: npx tsc --noEmit + npx vitest run (full) + your new/updated Playwright specs green. Cargo only if you touched Rust (state reason).
5. Self-review: codex-review --commit per major commit, cap ~3 rounds.
6. Push when green; do NOT merge. Evidence handoff with commit count + exact test output. Last line exactly: `WORKER-DONE: lp/wave4-gap-sync`
