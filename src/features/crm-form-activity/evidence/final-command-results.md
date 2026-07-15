# Final command results

Final code commit: `187ce69df75c483d686c3d12b86266362e32b126`

## Required changed check

```text
$ GATE_BASE=a6952a0acfe39d82b0375fcbd6be2ffd16d0b230 bash scripts/gate-changed.sh

Test Files  194 passed (194)
Tests  1446 passed (1446)
✅ CHANGED GATE GREEN
exit status: 0
```

The normal project environment includes Bun, so its blocking Intake contract
suite passed. The full command output was observed during this run, including
the passing contract suite, type checks, lint gate, and changed Vitest run.

## Machine receipt limitation

The machine receipt tool was attempted. It deliberately replaces `PATH` with
`/usr/bin:/bin`, which removes the installed Bun executable. Its gate therefore
reported this exact environment failure:

```text
❌ Bun is required to run the blocking Intake contract suite.
❌ FAILED: npm run test:contracts
```

The generated receipt was outside this feature's owned evidence folder and was
not committed. This is not represented as a green receipt. The normal gate
result above is the applicable result for this TypeScript-only lane.

## Other required checks on the final code commit

```text
$ npm run typecheck
exit status: 0

$ npm run typecheck:tests
exit status: 0

$ node scripts/ui-system/handle-guard.mjs
Handle guard passed — no permanent handle vanished, and no new ambiguous (duplicate) handles (64 frozen).
exit status: 0

$ npx vitest run src/features/crm-form-activity/FormActivitySurface.test.tsx src/features/crm-form-activity/FormActivitySurface.integration.test.tsx src/features/crm-form-activity/selectors.test.ts src/features/crm-form-activity/surfaceRegistration.test.ts
Test Files  4 passed (4)
Tests  8 passed (8)
exit status: 0

$ npx vitest run tests/unit/i18n/en-json-snapshot.test.ts
Test Files  1 passed (1)
Tests  5 passed (5)
exit status: 0
```
