# Unification sub-lane 4 result — CHANGES-3 fix round

`COORDINATOR:` The implementation reached the final desktop launch check, but
the second and final allowed canonical gate attempt was red. Activation has
been removed again. The branch is safe, committed, and intentionally **not
ready to land as activated**.

## State

- Base: `19de3e85f6c8b34099860c3cc46a0725510b95a5`
- Activation-under-test: `abfbd090ed7468421f176fe6561fdeb3935ea76c`
- Reviewed stop tip: `a51899f658c4acd917a58e0c110d857726872082`
- Fix-round code tip before evidence:
  `f8ce1c82f3499f752684e51735ed4b78ab38bed2`
- Activation: OFF at the safe tip
- Rust touched: no
- Tree after the evidence commit: expected clean
- Detailed receipt:
  `src/platform/client-context/evidence/integration-activation-receipt.md`

Evidence-only binding:

```text
git diff --name-only f8ce1c82f3499f752684e51735ed4b78ab38bed2..HEAD
prep/wave2-results/unification-sublane4-integration-activation.md
src/platform/client-context/evidence/integration-activation-receipt.md
```

## What was built

1. TrustBar, StatusBar, Spine, MatterHub, MattersHome, MatterScopeSelector,
   App navigation memory/echo, and MCP context now present the authoritative
   scope arm plus projection status. Blocked is visibly BLOCKED, explicit all
   remains All matters, and projection disagreement is visibly stale.
2. MCP selection information remains context only. Access grants are separate.
3. Explicit-all presentation and live consumer behavior were exercised.
4. The permanent named test
   `task-round-trip x reader-migration interaction` covers the live Tasks
   adapter under all-matters, matter-scoped, and blocked-unresolved.
5. The named test `boot-validation-failure-renders-BLOCKED` covers the old
   projection-null fail-open class through visible UI.
6. The test-only Matters public barrel is removed. Its tests now live beside
   the owned components, and the real boundary check passes unchanged.
7. All newly observable selector, navigation-memory, live MCP, and cleanup MCP
   output is behind the existing canonical flag. OFF keeps the landed shapes.
8. TrustBar, StatusBar, MatterHub, MattersHome, and Spine each have direct
   BLOCKED and stale DOM assertions.

Logical implementation commits:

```text
a20448d07 feat(selection): present authoritative scope truthfully
808a34add test(selection): prove task adapter across authority arms
b7db58c75 test(selection): align T2 integration fixtures
abfbd090e feat(selection): activate validated boot authority
4af5ce853 fix(selection): keep boot authority inactive after red gate
f8ce1c82f fix(selection): preserve inert output behind boot gate
```

The activation commit was deliberately one flag-only commit after item-by-item
precondition checks. The safety commit removes that line because the final gate
was not green.

## Proof that passed

- Required base and sub-lane-3 ancestry: PASS.
- Flag-off protected battery: 15 files / 214 tests PASS.
- `boot-validation-failure-renders-BLOCKED`: PASS.
- Activation-on focused amended battery: 30 files / 378 tests PASS.
- Fix-round full focused amended battery: 32 files / 385 tests PASS at
  `f8ce1c82f`.
- The permanent task interaction case was part of that run and passed.
- Production typecheck: PASS.
- Test typecheck: PASS.
- Boundaries: PASS — 599 existing baseline findings, zero regression.
- Architecture-boundary test: 1/1 PASS.
- Selection writer proof: 14/14 PASS; whole-tree scan PASS.
- Canonical gate attempt 2 passed boundaries, both TypeScript typechecks, the
  selection writer proof, 1,143 frontend test files / 9,099 tests, lint, handle
  guard, and the Rust suites reached after that point.

## Why the lane stopped

The last gate step built the desktop executable under the server's shared Cargo
build folder, then looked only in the worktree-local build folder:

```text
actual:   /mnt/devcache/cargo-target/debug/lantern
expected: src-tauri/target/debug/lantern

golden-loop launcher: cannot record provenance; binary is missing or not executable: target/debug/lantern
GATE RED
```

This was attempt 2 of 2. I did not run a third attempt, substitute an ad-hoc
golden-loop command, or describe the result as green.

## Attestation disposition

- Fresh checks on an activated final SHA: **not attestable** because the gate
  was red and activation was rolled back.
- Scope and guard integrity: PASS for this fix round. The public entry is gone;
  no boundary baseline, guard, test, timeout, assertion, or activation mechanism
  was weakened.
- Presentation truth: direct blocked/stale assertions pass for all five named
  surfaces; selector OFF attributes and MCP OFF JSON bytes are proven.
- Activation: preconditions passed and the flag was isolated, but final
  activation is withheld.
- Full release proof: **not attestable** because the canonical gate was red.
- Banked review: Opus SECURITY-PASS at `a51899f65` remains valid for the
  reviewed parent. The coordinator's required delta verification of
  `a51899f65..f8ce1c82f` is still pending and is not claimed here.

## Coordinator decision needed

Run the planned Opus delta verification. Activation remains safely OFF and the
old canonical gate remains honestly red; this fix round did not spend a third
gate attempt or touch the activation flip mechanism.
