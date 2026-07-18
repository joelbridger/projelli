# Workflow completion seam result

- Branch: `feat/workflow-completion-seam`
- Base: `8118b12cca5f05892e1418c254818268795694e8`
- Tested implementation SHA: `15c134a6f5fae729dcf0229fbd6b95ffd1e7b100`
- Final result tip: the commit containing this file
- Final-tip verification: `git notes --ref=verification show HEAD`

The verification note is attached after this file is committed. This avoids the
impossible task of making a commit contain its own SHA while still binding the
fresh terminal receipt to the exact final tip.

## Outcome

PASS. One canonical workflow-step completion writer now runs the append-only,
ordered validator list before calling the existing pure completion helper. The
Workflows completion button, Today work-item completion, and migration
checklist completion loop all use that writer. A typed refusal is surfaced as
`WorkflowCompletionRefusedError` through the existing error paths.

There is no behavior change while the validator list is empty. The focused
test fixes time and randomness, sends the same instance through the canonical
and pure paths, serializes both complete outputs, and proves the bytes are
identical.

## Fix-round diagnosis

The builder diagnosis was correct: the red test was wired incorrectly, not the
product seam. The fixture passed the intended blocked ID as the household ID.
`startWorkflow` generates a separate workflow-instance ID unless its third
argument supplies one, so the validator correctly allowed that instance. The
fixture now gives the household a stable household ID and passes the blocked ID
as the explicit workflow-instance ID. No assertion was weakened and no product
behavior was changed to fit the broken test.

Reproduced before the fixture fix:

```text
Test Files  1 failed | 1 passed (2)
Tests       1 failed | 13 passed (14)

FAIL workflowCompletionSeam.test.ts > workflow completion seam > surfaces a
typed refusal and prevents every production completion entry from producing a
saveable instance
AssertionError: expected Error: Workflows per-step completion butt… to be an
instance of WorkflowCompletionRefusedError
```

## Required implementation-tip evidence

All commands below ran at
`15c134a6f5fae729dcf0229fbd6b95ffd1e7b100`. The same complete battery was rerun
after this result file was committed; that final-tip transcript is the
`verification` git note named above.

### Focused suite

```text
$ npm exec vitest run -- src/features/crm-home/workflowLive.test.ts src/features/crm-home/workflowCompletionSeam.test.ts

 RUN  v4.1.3 /home/jameson/lantern/app/integration/.worktrees/feat/workflow-completion-seam

 Test Files  2 passed (2)
      Tests  14 passed (14)
   Duration  1.30s

exit 0
```

This includes the byte-identical empty-list proof, validator ordering, typed
refusal shape, refusal at all three completion entry paths, and the whole-tree
no-stray-caller guard.

### TypeScript

```text
$ npm run typecheck

> advisor-prep-hero@3.3.5 typecheck
> tsc --noEmit

exit 0
```

### Feature boundaries

```text
$ npm run boundaries:check

> advisor-prep-hero@3.3.5 boundaries:check
> node scripts/check-boundaries.mjs

✅ No feature-boundary regression (599 current baseline finding(s)).
exit 0
```

### Whole-tree completion scan

Scope: production `src/**/*.ts` and `src/**/*.tsx`; test/spec files and
`__tests__` directories are excluded. `workflowLive.ts` is the sanctioned owner
of the pure helper.

```text
DIRECT_HELPER_CALLS
src/features/crm-home/workflowLive.ts:202:export function completeWorkflowStep(instance: LiveWorkflowInstance, stepId: string, outcomeId?: string): LiveWorkflowInstance {
src/features/crm-home/workflowLive.ts:230:  return completeWorkflowStep(instance, stepId, outcomeId);

CANONICAL_WRITER_PRODUCTION_CALLS
src/features/crm-home/workflowLive.ts:220:export function applyWorkflowStepCompletion(
src/features/crm-home/shared/LiveCrmHome.tsx:567:    await live.save(applyWorkflowStepCompletion(instance, item.stepId));
src/features/crm-home/shared/LiveCrmHome.tsx:657:          instance = applyWorkflowStepCompletion(instance, step.id);
src/features/crm-workflows/Workflows.tsx:933:                            applyWorkflowStepCompletion(
```

`git diff --check` also exited 0 with no output.

## Fence attestation

Only the four granted source/test files and this required result file changed.
No selection, client-context, matter, shell, routing, placement,
`useWorkflowRunner.ts`, `workflowStepPersistence.ts`,
`workflowExtensionRegistry.tsx`, or `extensions/**` file was touched.
