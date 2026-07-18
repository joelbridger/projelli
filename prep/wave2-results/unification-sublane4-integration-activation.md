# Unification sub-lane 4 result — coordinator stop

`COORDINATOR:` The implementation reached the final desktop launch check, but
the second and final allowed canonical gate attempt was red. Activation has
been removed again. The branch is safe, committed, and intentionally **not
ready to land as activated**.

## State

- Base: `19de3e85f6c8b34099860c3cc46a0725510b95a5`
- Activation-under-test: `abfbd090ed7468421f176fe6561fdeb3935ea76c`
- Safe code tip before evidence:
  `4af5ce853c79a114966ffb651415b69207548436`
- Activation: OFF at the safe tip
- Rust touched: no
- Tree after the evidence commit: expected clean
- Detailed receipt:
  `src/platform/client-context/evidence/integration-activation-receipt.md`

Evidence-only binding:

```text
git diff --name-only 4af5ce853c79a114966ffb651415b69207548436..HEAD
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

Logical implementation commits:

```text
a20448d07 feat(selection): present authoritative scope truthfully
808a34add test(selection): prove task adapter across authority arms
b7db58c75 test(selection): align T2 integration fixtures
abfbd090e feat(selection): activate validated boot authority
4af5ce853 fix(selection): keep boot authority inactive after red gate
```

The activation commit was deliberately one flag-only commit after item-by-item
precondition checks. The safety commit removes that line because the final gate
was not green.

## Proof that passed

- Required base and sub-lane-3 ancestry: PASS.
- Flag-off protected battery: 15 files / 214 tests PASS.
- `boot-validation-failure-renders-BLOCKED`: PASS.
- Activation-on focused amended battery: 30 files / 378 tests PASS.
- The permanent task interaction case was part of that run and passed.
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
- Scope and guard integrity: no guard weakening found. One possible fence
  crossing is disclosed in the receipt: a four-line Matters public entry was
  added for the focused test's architecture-safe import, despite the brief's
  “no public export” rule.
- Presentation truth: focused tests passed, but coordinator review remains
  pending.
- Activation: preconditions passed and the flag was isolated, but final
  activation is withheld.
- Full release proof: **not attestable** because the canonical gate was red.
- Two clean self-reviews: not run after the hard stop.
- Independent different-model review: coordinator-arranged and still pending.

## Coordinator decision needed

Please decide whether to repair the canonical golden-loop command so it uses
the shared Cargo output (or locally neutralizes that setting), and whether to
grant a new gate attempt. Please also decide whether the test-only Matters
public entry must be removed. If work resumes, the lane still needs a fully
green activated gate, the exact post-edit proof commands, two clean self-review
rounds, and the coordinator's independent review before it can be accepted.
