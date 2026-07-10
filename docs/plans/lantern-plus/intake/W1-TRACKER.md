# Lantern Intake — Wave 1 Tracker

**Wave lead:** Opus 4.8 · high. **Branch:** `lp/intake` (worktree `~/lp-intake`), off `lp/ux-simplify-v1` `3939b96c`.
**Plan:** `W1-EXEC-PLAN.md`. **Briefs:** `briefs/w1-<lane>.md`.

## Lane status

| Lane | Slug | Worktree | Branch | Codex | Review | Adversarial | Merged SHA | Status |
|---|---|---|---|---|---|---|---|---|
| A | contracts-crypto | `~/lp-w1-A` | `lp/intake-w1-A` | DONE-EXIT:0 | PASS (lead read) | PASS + 3 hardenings folded | in `2942df73` | **MERGED** |
| B | relay | `~/lp-w1-B` | `lp/intake-w1-B` | DONE-EXIT:0 | PASS (lead read) | running | — | REVIEWED, adversarial running |
| C | client-page | `~/lp-w1-C` | `lp/intake-w1-C` | building | — | — | — | BUILDING |
| D | advisor-side | `~/lp-w1-D` | `lp/intake-w1-D` | building | — | — | — | BUILDING (only cargo lane) |
| E | hosting | `~/lp-w1-E` | `lp/intake-w1-E` | building | — | — | — | BUILDING |

## Gate evidence (filled at each merge)

- **Lane A:** independent `npx vitest run src/platform/intake` → 25/25 passed; `tsc --noEmit` + `typecheck:tests` + `eslint src/platform/intake` clean. Adversarial pass: codex gpt-5.5 xhigh, `codex-review --base lp/intake` → 1 formal P2 (weak link secret) + 2 manifest-validation gaps, all folded (commit `cb9a9e95`). `npm run gate` on merged `lp/intake`: entire TS half GREEN (typecheck, typecheck:tests, brand, identity, i18n, vitest, eslint gate, handle/token guards all ✅); cargo skipped-with-reason for Lane A (pure TS, zero Rust).
- **Lane B:** independent `bun test test/intake.test.ts test/intake-privacy-proof.test.ts` → 8/8 passed; codex reports `bun test` full → 208 passed, typecheck clean. Lead read: uniform-410 decoy-hash constant-time compare ✓, HMAC-only token storage ✓, durable DB dedup (`UNIQUE(intake_id,submission_id)` + immediate-txn precheck) ✓, chunk keyed `(intake,item,submission,idx)` ✓, caps + rate limits ✓, privacy-proof scans all tables ✓. Adversarial pass running.

## Environment notes / known issues
- **Sidecar binaries gap (fixed in lp-intake + lp-w1-D):** fresh `lp-*` worktrees lack `src-tauri/binaries/*` (piper/espeak/ggml/llama — gitignored). Cargo build script fails `resource path binaries/piper-... doesn't exist`. Fix: `cp -a ~/lp-ux-integrate/src-tauri/binaries/. <worktree>/src-tauri/binaries/`. (Same class as the OCR-wasm gap.)
- **Baseline cargo flake (pre-existing, NOT intake):** `commands::mail::tests::backfill_marker_set_is_idempotent_and_clearable` fails under the parallel `cargo test --workspace` run (leaked marker state: `Some("1")` vs `None`) but **passes in isolation** (`--test-threads=1 --exact`). Treat as a known baseline flake; when Lane D's cargo runs, re-run this one in isolation if it appears — it is not a Lane D regression (Lane D adds new `commands::intake` tests).

## Pending sync (coordinator note, 2026-07-10)
- Pull `docs/plans/lantern-plus/intake/W2-PREP.md` + `docs/trust/it-pack/INTAKE-IT-PACK.md` from `lp/ux-simplify-v1` (`f9228650`) into `lp/intake` at the next clean sync point — AFTER the Wave 1 lanes merge (avoid stirring base drift into in-flight lane merges). Fold in during Wave 1 wrap.

## Bench needs (for the Legion runner, AFTER WORKER-DONE)
- V6: complete all 5 items incl. camera uploads on a phone-sized browser against the staged relay; verify decrypt-and-file on desktop; screenshot.
- V7: real iOS Safari + Android Chrome camera capture.
- V9: intake keychain on real Windows (Credential Manager).
- V10: regenerate link mid-flow; old link dies; page works on new link.

## Log
- **2026-07-10:** Wave kicked off. Plan package (ARCHITECTURE/PRODUCT-DESIGN/WAVE-PLAN/RISKS/QUESTIONS + design brief) brought into `lp/intake` from `plan/intake-design` (surgical checkout, not full merge — that branch carried 9k lines of unrelated coordination churn). Verified all reuse-anchor files exist. Wrote `W1-EXEC-PLAN.md` + Lane A brief. Dispatching Lane A (contracts + crypto) alone first.
