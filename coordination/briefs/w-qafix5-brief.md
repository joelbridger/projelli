# Build brief — QA fix batch 5: QA-34 P0 silent data loss on save failure + QA-36 reserved-name validation

**Lane:** cc-lantern-qafix5 · dir `~/lp-qafix5` (own worktree, branch `lp/qa-fix-batch5`). **Model:** Opus 4.8 · high (P0 data-integrity on the core save path — coordinator-stated reason).
**Read FIRST:** BUG-DB QA-34 + QA-36 full rows + the qa5 lane detail + evidence `coordination/qa-campaign/evidence/qa5-20260704/` (52 screenshots). **Rules:** NO-SHORTCUTS (this is the save path — the single most trust-critical code in the app). TDD, red-first. Codex self-review foreground/watched, ≥2 clean-adjacent rounds (data-integrity bar). PULL + reconcile before handoff. Unique dev-server port.

## Lane boundary (three lanes live)
transfix owns transcription Rust; noticekit owns consent/meetings UI surfaces. You own the SAVE/WRITE path: `WorkspaceService`, autosave (`src/app/lifecycle/useAutosave.ts`), the Command pattern write path, `PathValidator`/pathguard naming validation, and the editor dirty-state plumbing. If your fix genuinely needs a meetings or consent file, STOP and ask (`COORDINATOR:`).

## QA-34 (P0): one failed autosave write permanently kills persistence for that document — while the UI says "Saved"
Repro (real, on bench-2): hold an exclusive OS lock on a doc's file (antivirus/backup simulation) → the app's autosave write fails ONCE → the app **never retries and never writes again for that document**, UI shows "Saved" indefinitely, even after the lock is released; restart reveals the content was never persisted (total loss of everything typed since). Fix robustly, both layers:
1. **Truthful save state:** the dirty-dot/"Saved" indicator must reflect REALITY — a failed write leaves the doc dirty and the UI saying so ("Couldn't save — retrying"), never a false "Saved". Find why one failure wedges the pipeline (swallowed rejection? a dirty-flag cleared optimistically before the write settles? a dead debounce timer?) — state the proven mechanism in your handoff.
2. **Resilient retry:** failed writes retry with backoff while the doc stays dirty; when the lock clears (the common AV case clears in seconds), the save lands and the indicator returns to Saved honestly. Persistent failure (minutes) escalates to a visible, non-dismissable-by-timeout warning ("This document can't be saved — another program may be blocking the file") with the data kept safe in memory + offer "Save a copy elsewhere" as the escape hatch.
3. **Tests:** red-first — a mock FS write that fails once then succeeds (must recover + persist everything); fails persistently (must warn + never show Saved); the restart-simulation proving no silent loss. If the Windows-exclusive-lock behavior needs a Rust-level test, follow the pathguard red-on-Windows precedent.

## QA-36 (P2, same neighborhood): reserved Windows names accepted
`CON.docx` etc. are accepted by the naming dialog and actually created on NTFS via the `\\?\` path style — then Windows' own tools can't rename/delete them (user trap). Add validation at the naming layer (client-side + the Rust create path defense-in-depth): reject reserved device names (CON, PRN, AUX, NUL, COM1-9, LPT1-9, with/without extension), trailing dots/spaces — honest inline error. Tests table-driven. (qa3's browser round has the same finding on the mock FS — one fix covers both.)

## Gate + handoff
`npx tsc --noEmit` · `typecheck:tests` 0 · i18n 0 (new strings localized en/de/es) · full vitest · eslint-gate · Rust-touched ⇒ own `CARGO_TARGET_DIR=$HOME/.cargo-target-lp-qafix5`, `timeout 1200`, one cargo box-wide. Handoff: HEAD SHA · the PROVEN QA-34 mechanism · gate counts · Rust yes/no · self-review rounds. Push (NOT self-merged), then exactly: `WORKER-DONE: lp/qa-fix-batch5`
