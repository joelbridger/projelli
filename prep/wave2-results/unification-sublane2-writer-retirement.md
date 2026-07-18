# Unification sub-lane 2 — writer retirement

- Branch: `feat/unification-sublane2-writer-retirement`
- Verified base: `dcb49570f9244fe81f683963050b6a7016d505cd`
- Tested implementation: `524d9c285cc28a64acf44164a7eee76ae52abe85`
- Receipt: `src/platform/client-context/evidence/writer-retirement-receipt.md`
- Rust touched: no
- Dark activation flag: still OFF by default
- Pushed/merged: no/no

## Outcome

Every production selection change now enters the sealed source-owned path.
The legacy `activeMatterId` value is a follower, not authority. Its only enabled
writer is the source projection. Matter choices can settle as full-pair,
matter-only, or blocked; explicit All remains its own sealed intent. Client
choices settle as a full pair or retained-client/null blocked. All persistence
and restart inputs are hints and are reclassified from current data.

All required W1-W7, A2-1-A2-5, I1-I4, and C1-C4 dispositions, their new-arm
columns, base/final locations, tests, seed decisions, public-surface audit, and
exact writer proof are in the receipt.

## Evidence summary

- Base production inventory: eleven external matter-follower callers, one
  sanctioned projection, four direct client set/clear callers.
- Final inventory: one source-owned projection; zero external follower calls;
  zero direct client calls.
- Machine proof: 7/7 positive/negative audit tests passed.
- Fresh focused battery at `524d9c285`: 14 files, 136 tests passed.
- TypeScript app and test typechecks passed.
- Lint gate passed without changing its baseline.
- Handle guard passed; architecture boundary test passed.
- `git diff --check` passed.

The canonical gate used both allowed attempts. Attempt 2 passed the entire
frontend suite (1,132 files passed, 3 skipped; 9,002 tests passed, 29 skipped),
but the overall gate is honestly RED: the worktree lacks the required Piper
sidecar binary, so Rust/golden work could not start. The lint findings reported
after that frontend run were fixed and the lint gate was rerun green. A third
full gate was not permitted.

## Review disposition

Two independent Sol review attempts were completed. Every real finding was
fixed: classifier fingerprint stability, disk-hint capture timing, canonical
gate integration, exact single-writer enforcement, destructured/indirect/
bracket proof bypasses, and navigation snapshot ordering. The reviewer twice
suggested waiting for provider data during restart. That is not adopted because
the binding Reassessment Addendum requires unavailable provider liveness for a
saved shared/full-pair source to classify blocked, and blocked must not
auto-upgrade. The focused restart test proves that exact rule and explicit
reselection recovery.

## Honest handoff

No frame gap was found. No reader-matrix work, T1/T2 migration, Meetings
surface work, Rust change, activation, merge, push, baseline change, or guard
weakening is included. The tree will contain only this report/receipt commit
after the tested implementation SHA; the coordinator should retain the honest
canonical-gate RED caused by the missing sidecar when reviewing the lane.
