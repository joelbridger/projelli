# Unification sub-lane 4 result — activated gate green

The granted lint-cure attempt is complete. All lane-owned ESLint findings were
fixed without suppressions or baseline changes, activation is ON, and the
complete activated gate is green through the real desktop persistence loop.

## State

- Base: `19de3e85f6c8b34099860c3cc46a0725510b95a5`
- Granted rerun launch base: `29f102dae3accb0e06157ddcff86a0e5129d72e0`
- Lint-cure commit: `f4e58a9d8`
- Activation-under-test: `5dd4f06e567465dc7110e873cdbcc82b7c78c44e`
- Reviewed stop tip: `a51899f658c4acd917a58e0c110d857726872082`
- Fix-round code tip before evidence:
  `f8ce1c82f3499f752684e51735ed4b78ab38bed2`
- Activation: ON through `.env.production`
- Rust touched: no
- Tree after the evidence commit: expected clean
- Detailed receipt:
  `src/platform/client-context/evidence/integration-activation-receipt.md`

Evidence-only binding:

```text
git diff --name-only 5dd4f06e567465dc7110e873cdbcc82b7c78c44e..HEAD
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
f4e58a9d8 test(selection): satisfy activation lint gate
5dd4f06e5 feat(selection): activate validated boot authority
```

The activation commit was deliberately one flag-only commit after item-by-item
precondition checks. The granted rerun restores that single line only after the
lint cure was committed.

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
- Granted complete activated gate: **GREEN** at `5dd4f06e5`.
- Frontend suite: 1,145 files / 9,108 tests PASS; 3 files / 27 tests skipped.
- ESLint gate: no regression; 63 baseline fingerprints cleaned.
- Rust workspace tests: PASS, including core, DOCX, vault, integration, and
  doc-test suites.
- Golden loop: PASS — a real `.docx` was created, displayed, survived app
  restart, and remained visible.

Exact gate command:

```text
CARGO_TARGET_DIR=<worktree>/src-tauri/target npm run gate
✅ GATE GREEN
```

## Previous blocked attempt (historical)

The last gate step built the desktop executable under the server's shared Cargo
build folder, then looked only in the worktree-local build folder:

```text
actual:   /mnt/devcache/cargo-target/debug/lantern
expected: src-tauri/target/debug/lantern

golden-loop launcher: cannot record provenance; binary is missing or not executable: target/debug/lantern
GATE RED
```

That earlier capped attempt was correctly left red and dark. The coordinator
later granted one dedicated lint-cure rerun with the corrected local Cargo
target; the green result above supersedes the old stop status.

## Attestation disposition

- Fresh checks on the activated code SHA: **PASS** at `5dd4f06e5`.
- Scope and guard integrity: PASS for this fix round. The public entry is gone;
  no boundary baseline, guard, test, timeout, assertion, or activation mechanism
  was weakened.
- Presentation truth: direct blocked/stale assertions pass for all five named
  surfaces; selector OFF attributes and MCP OFF JSON bytes are proven.
- Activation: ON in the isolated one-line activation commit.
- Full release proof: **PASS** through the canonical gate and real desktop
  create/save/restart/persistence loop.
- Banked review: Opus SECURITY-PASS at `a51899f65` remains valid for the
  reviewed parent. The coordinator's required delta verification of
  `a51899f65..f8ce1c82f` is still pending and is not claimed here.

## Handoff

The lane is ready for coordinator review as an activated result. The gate-tested
code SHA is `5dd4f06e5`; the following receipt-only commit binds these results.
