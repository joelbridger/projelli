# WB-062 workflow start gate result

- Branch: `v1/workflow-start-gate`
- Verified launch base: `f6973732479cac37df3722c7411a701f768ec1d5`
- Implementation commit: `c716b9843`
- Receipt-bearing final-tip SHA and clean-status proof:
  `git notes --ref=verification show HEAD`
  (The verification note is attached after this receipt is committed and all
  checks are rerun. This avoids putting a false self-referencing SHA inside the
  commit that creates it.)
- Pushed/merged: no/no

## Result

PASS for the builder-owned WB-062 outcome.

The real Workflow screen now always shows its existing Start workflow control.
It searches the full template list for a published or legacy startable
template, so an earlier draft or archived template cannot hide a later
published one. With no startable template, the control is disabled and a
visible sentence explains why. The existing start callback searches the full
list again when clicked, so a template that becomes rejected cannot create a
household or workflow instance while the screen is still showing its earlier
enabled state.

A published template remains enabled and follows the unchanged production
start flow: the selected canonical template and household go to the existing
`startWorkflow` helper, and the resulting instance crosses the existing
`onSave` boundary. Templates saved before lifecycle statuses existed keep their
previously startable behavior.

## Focused proof

`Workflows.startGate.test.tsx` mounts the real `LiveWorkflows` screen and proves:

- zero templates: the real button is disabled and its reason is accessible and
  visible; a separately enabled render also saves nothing when its template
  disappears immediately before the click;
- a draft template: the button says publication is required; a separate click
  on a genuinely enabled React control saves nothing when that template changes
  to draft immediately before the click;
- an archived record reaching the broad live-record boundary: the button stays
  unavailable; a separate click on a genuinely enabled React control saves
  nothing when that template changes to archived immediately before the click;
- a draft first template followed by a published template: Start stays enabled
  and saves an instance from the published template;
- a template that changes from published to rejected after the first render:
  a rerender disables the button, while a separate no-rerender fire-time check
  clicks a genuinely enabled React control and proves the handler saves nothing;
  and
- a published template: the real household selection and Start click save
  exactly one workflow instance carrying the existing template ID, household
  ID, matter ID, and template name.

No template, instance, household, or alternate store is fabricated by the gate.

## Verification

The final-tip verification note records the exact final SHA, clean status, and
fresh output from these commands:

```text
npx vitest run src/features/crm-workflows/Workflows.startGate.test.tsx
npx vitest run src/features/crm-home/workflowCompletionEntryPoints.test.tsx src/features/crm-workflows/record-quickadd/recordQuickAdd.handoff.live.test.tsx
npm run typecheck
npm run typecheck:tests
npm run boundaries:check
npx vitest run tests/unit/architecture-boundaries.test.ts
npx eslint src/features/crm-workflows/Workflows.tsx src/features/crm-workflows/Workflows.startGate.test.tsx
git diff --check f6973732479cac37df3722c7411a701f768ec1d5..HEAD
git status --short
```

Focused result: 10/10 tests pass. Adjacent workflow result: 6/6 tests pass.
Both type checks pass. Feature and architecture boundary checks pass. Touched
file ESLint has zero errors and only the eight pre-existing async warnings in
`Workflows.tsx`; no warning suppression was added.

## Review

Self-review: PASS. The start-control condition and its existing callback are the
only production behavior changed. The landed `applyWorkflowStepCompletion`
wiring remains untouched.

Independent review verdict: pending. Per the fire-time coordinator delta, the
coordinator owns the separate review and will use a different model.

## Scope attestation

The whole-tree changed-path scan contains only:

- `src/features/crm-workflows/Workflows.tsx`
- `src/features/crm-workflows/Workflows.startGate.test.tsx`
- `prep/wave2-results/workflow-start-gate.md`

No workflow extension registry, workflow step persistence, dependent-due
extension, record-start slot, CRM-home, selection/client/matter, shell/routing,
flags, locales, native/Rust, migration, or template-store file changed. No
suppression, skip, snapshot, weakened assertion, second start path, or alternate
store was added.
