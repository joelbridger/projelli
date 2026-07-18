# Unification sub-lane 2 — writer retirement

- Branch: `feat/unification-sublane2-writer-retirement`
- Verified base: `dcb49570f9244fe81f683963050b6a7016d505cd`
- Tested implementation: `636ba77c2ac841ecfcea3c62829b410c3f192c91`
- Receipt: `src/platform/client-context/evidence/writer-retirement-receipt.md`
- Receipt-bearing final-tip proof: `git notes --ref=verification show HEAD`
  (the note is attached after this record is committed, so it can name the
  receipt-bearing commit without the impossible task of a commit embedding its own SHA)
- Rust touched: no
- Dark activation flag: still OFF by default
- Pushed/merged: no/no

## Outcome

Every selection change in the required `src` and `scripts` tree now enters the
sealed source-owned path. The two Northcrest demo helpers select All Clients by
clicking the real app control, which enters the same door as a user action.
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
- Machine proof: 9/9 positive/negative audit tests passed, including a synthetic
  direct script assignment and a temporary-tree proof that `scripts` is scanned.
- Fresh focused product battery at `636ba77c2`: 13 files, 132 tests passed.
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

## Final implementation-tip verification

The complete scoped battery was rerun after the fix commit, at the immutable
implementation SHA above. Exact identifying and summary output:

```text
$ git rev-parse HEAD
636ba77c2ac841ecfcea3c62829b410c3f192c91

$ npm run selection:writers:test
1..9
# tests 9
# pass 9
# fail 0

$ npm run selection:writers:check
ALLOW src/platform/client-context/clientContextStore.ts:779 single source-owned follower projection
PASS: one follower projection writer; zero direct client writers.

$ npx vitest run <13 writer/lifecycle product files> --reporter=dot
Test Files  13 passed (13)
Tests       132 passed (132)

$ npx tsc --noEmit
# exit 0
$ npm run typecheck:tests
# exit 0
$ npm run lint:gate
✅ No ESLint regression vs baseline. (63 fingerprint(s) cleaned up vs baseline)
$ node scripts/ui-system/handle-guard.mjs
✅ Handle guard passed — no permanent handle vanished, and no new ambiguous (duplicate) handles (64 frozen).
$ npx vitest run tests/unit/architecture-boundaries.test.ts
Test Files  1 passed (1)
Tests       1 passed (1)
$ git diff --check
# exit 0
```

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
