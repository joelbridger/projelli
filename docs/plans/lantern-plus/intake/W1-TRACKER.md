# Lantern Intake — Wave 1 Tracker

**Wave lead:** Opus 4.8 · high. **Branch:** `lp/intake` (worktree `~/lp-intake`), off `lp/ux-simplify-v1` `3939b96c`.
**Plan:** `W1-EXEC-PLAN.md`. **Briefs:** `briefs/w1-<lane>.md`.

## Lane status

| Lane | Slug | Worktree | Branch | Codex | Review | Adversarial | Merged SHA | Status |
|---|---|---|---|---|---|---|---|---|
| A | contracts-crypto | `~/lp-w1-A` | `lp/intake-w1-A` | dispatched | — | — | — | BUILDING |
| B | relay | — | — | blocked on A | — | — | — | WAITING |
| C | client-page | — | — | blocked on A | — | — | — | WAITING |
| D | advisor-side | — | — | blocked on A | — | — | — | WAITING |
| E | hosting | — | — | blocked on A | — | — | — | WAITING |

## Gate evidence (filled at each merge)

_(none yet)_

## Bench needs (for the Legion runner, AFTER WORKER-DONE)
- V6: complete all 5 items incl. camera uploads on a phone-sized browser against the staged relay; verify decrypt-and-file on desktop; screenshot.
- V7: real iOS Safari + Android Chrome camera capture.
- V9: intake keychain on real Windows (Credential Manager).
- V10: regenerate link mid-flow; old link dies; page works on new link.

## Log
- **2026-07-10:** Wave kicked off. Plan package (ARCHITECTURE/PRODUCT-DESIGN/WAVE-PLAN/RISKS/QUESTIONS + design brief) brought into `lp/intake` from `plan/intake-design` (surgical checkout, not full merge — that branch carried 9k lines of unrelated coordination churn). Verified all reuse-anchor files exist. Wrote `W1-EXEC-PLAN.md` + Lane A brief. Dispatching Lane A (contracts + crypto) alone first.
