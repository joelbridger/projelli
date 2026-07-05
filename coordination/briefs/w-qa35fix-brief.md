# Fix brief — QA-35: recording keeps "counting" at zero disk free (investigate → fix honestly)

**Lane:** cc-lantern-qa35fix · dir `~/lp-qa35fix` (own worktree, branch `lp/qa-fix-batch7`). **Model:** Sonnet 5 · high.
**Read FIRST:** BUG-DB QA-35 (P1/P2, causation NOT fully isolated — qa5's honest note) + evidence `coordination/qa-campaign/evidence/qa5-20260704/`. **Rules:** NO-SHORTCUTS. TDD. Codex self-review foreground/watched. PULL + reconcile before handoff. Rust rules if touched: own CARGO_TARGET_DIR=$HOME/.cargo-target-lp-qa35fix, timeout 1200, one cargo box-wide.

## The finding
On bench-2 with disk driven to true zero free bytes DURING an active meeting recording, the UI kept showing a live-incrementing "Recording… M:SS" timer with no error for as long as observed. Unknown: whether audio chunks were actually still being written (buffered? partial?), whether the recording was salvageable after, and where the write failure (if any) was being swallowed.

## Tasks
1. **Isolate the real behavior** at the unit/Rust level first (no bench needed initially): what does the capture engine's chunk-writer do when a write hits ENOSPC? Does an error propagate to the UI state? Does finalize succeed/fail/corrupt? Write the red test that simulates ENOSPC mid-recording (mock/dev-fs or a small quota trick).
2. **Fix honestly per the app's established pattern** (the QA-31/QA-40 school): a failing chunk write must surface within seconds — pill switches to an honest error state ("Recording can't continue — disk is full"), recording stops cleanly, everything captured so far is preserved and finalized (never corrupt/discard the partial), ledger records the truncation with timestamp. Low-disk WARNING earlier if cheap (e.g. below a threshold at record-start: "Low disk space — long recordings may not fit").
3. If time permits and the fix is Rust-side: verify on bench-2 with the real disk-fill repro (VM start/deallocate; snapshot-reset if you break it; unique tunnel port). Honest handoff if you skip live verify — say exactly what was proven at which layer.

## Gate + handoff
tsc · typecheck:tests 0 · i18n 0 · full vitest · eslint-gate · cargo if Rust touched. Handoff: PROVEN ENOSPC behavior (before/after), gate counts, live-verify status. Push (NOT self-merged), then exactly: `WORKER-DONE: lp/qa-fix-batch7`
