# WB-039 task-priority parity result

- Branch: `v1/task-priority-parity`
- Verified base: `8118b12cca5f05892e1418c254818268795694e8`
- Final tested implementation SHA: `adcf61dacc2bd775d4ff9233a76fae1336ce3f1e`
- Receipt-bearing final-tip proof: `git notes --ref=verification show HEAD`
  (the note is attached after this receipt is committed, so it can name the
  receipt-bearing commit without asking a commit to embed its own SHA)
- Pushed/merged: no/no

## Result

PASS for the builder-owned outcome. The task list now shows High, Normal, and
Low as compact urgency badges with both readable words and distinct ▲, ◆, and
▼ shapes. Colour reinforces the signal but is not its meaning. The task editor
shows the same live badge, keeps the existing native priority select, and gives
that select a screen-reader name containing its current value.

No priority model, enum, store, migration, preference, or alternate save path
was added. The existing `onUpdateTask` route is unchanged. Legacy records with
no stored priority still project as the existing `normal` default.

## Fire safety proof

The exact slate grep was rerun at the fire SHA before editing:

```text
$ git grep -n -E "platform/client-context|platform/matter/matterStore|Spine|MattersHome|MatterScopeSelector|App\.tsx|AppSurfaceRouter|primaryNav|PrimaryNav|Shell|AppShell|crm-home/registry|CrmHomeSurfaceDescriptor" 8118b12cca5f05892e1418c254818268795694e8 -- src/features/crm-tasks/Tasks.tsx src/features/crm-tasks/taskExtensionRegistry.tsx src/features/crm-tasks/Tasks.actionContext.test.tsx
grep_exit=1
```

This is the expected zero-match result. The slate still says no active lane
owns `Tasks.tsx`, and the path is not an R3 reader/writer table entry.

## Persistence and default proof

`Tasks.priority.test.tsx` starts with a canonical live task record whose
priority is absent. A fresh `useTaskRecordStore()` reader returns `normal`.
The test focuses the native select, changes it to High, and presses the existing
Save button. It proves the screen calls the supplied update route with
`priority: 'high'`; the canonical store calls its existing `save` and `reload`;
the writer is then unmounted; and a newly mounted reader returns `high` from the
committed record rather than from editor state or the save echo.

```text
$ npx vitest run src/features/crm-tasks/Tasks.priority.test.tsx
Test Files  1 passed (1)
Tests       2 passed (2)
Duration    4.53s
```

## Accessibility proof

The focused test makes no palette-only assertion. It proves:

- list markers have the accessible names `High priority`, `Normal priority`,
  and `Low priority`;
- their visible contents are `▲High priority`, `◆Normal priority`, and
  `▼Low priority`;
- each task's keyboard-openable button includes the same priority words in its
  accessible name;
- the native select can receive focus; and
- its accessible name changes from `Task priority: Normal priority` to
  `Task priority: High priority`, while the live editor status announces
  `High priority`.

## Final implementation-tip checks

All required checks below ran at
`adcf61dacc2bd775d4ff9233a76fae1336ce3f1e`:

```text
$ git rev-parse HEAD
adcf61dacc2bd775d4ff9233a76fae1336ce3f1e

$ npx vitest run src/features/crm-tasks/Tasks.priority.test.tsx
Test Files  1 passed (1)
Tests       2 passed (2)

$ npm run typecheck
> tsc --noEmit
# exit 0

$ npm run typecheck:tests
> tsc -p tsconfig.test.json --noEmit
# exit 0

$ npm run boundaries:check
✅ No feature-boundary regression (599 current baseline finding(s)).

$ npx vitest run tests/unit/architecture-boundaries.test.ts
Test Files  1 passed (1)
Tests       1 passed (1)

$ npx eslint src/features/crm-tasks/Tasks.tsx src/features/crm-tasks/Tasks.priority.test.tsx
Tasks.tsx:244:15  warning  lantern-async/no-silent-failure
Tasks.tsx:788:13  warning  lantern-async/no-silent-failure
✖ 2 problems (0 errors, 2 warnings)
# exit 0

$ npx eslint /home/jameson/lantern/app/integration/src/features/crm-tasks/Tasks.tsx
Tasks.tsx:168:15  warning  lantern-async/no-silent-failure
Tasks.tsx:702:13  warning  lantern-async/no-silent-failure
✖ 2 problems (0 errors, 2 warnings)
# exit 0; the exact two warnings already exist at the verified base

$ git diff --check 8118b12cca5f05892e1418c254818268795694e8..HEAD
# exit 0
```

No suppressions, skips, snapshots, or weakened assertions were added.

## Whole-tree scan and scope attestation

The whole tracked runtime/test code scan covered `src/**`, `tests/**`,
`scripts/**`, and `src-tauri/**`. Explicit exclusions were non-runtime
`prep/**`, `docs/**`, marketing/research/evidence, and Git-ignored generated
dependencies/build outputs (`node_modules`, `dist*`, and `target`). Those
excluded areas cannot host the task screen's runtime model or save route.

```text
$ git grep -l -E "TaskPriority|task priority|task-priority|crm-task-priority|priority.{0,40}task|task.{0,40}priority" HEAD -- src tests scripts src-tauri
scripts/crm-loop/tasks.mjs
scripts/crm-loop/today-tasks.mjs
scripts/crm-loop/views.mjs
scripts/ui-system/handles.baseline.json
src-tauri/src/commands/crm/model.rs
src/features/crm-home/shared/liveTaskAdapter.ts
src/features/crm-tasks/Tasks.priority.test.tsx
src/features/crm-tasks/Tasks.tsx
src/features/crm-tasks/extensions/capacity-triage/CapacityTriageAction.tsx
src/features/crm-tasks/extensions/create/TaskCreateTemplate.test.tsx
src/features/crm-tasks/extensions/create/TaskCreateTemplate.tsx
src/features/crm-tasks/extensions/create/contract.ts
src/features/crm-tasks/extensions/templates-admin/TaskTemplatesAdminSettings.tsx
src/features/crm-tasks/extensions/templates/TaskTemplateLibrary.tsx
src/features/crm-tasks/extensions/templates/contract.ts
src/features/crm-tasks/extensions/templates/taskTemplateStore.ts
src/features/crm-tasks/index.ts
src/features/crm-tasks/taskRecordStore.ts
src/platform/crm/tasks/index.test.ts
tests/acceptance/run.mjs
tests/chaos/run.mjs
tests/multiclient/layer2.ts
tests/parity/manifest.ts
tests/parity/run.ts
scan_exit=0

$ git diff --name-status 8118b12cca5f05892e1418c254818268795694e8..HEAD
A  src/features/crm-tasks/Tasks.priority.test.tsx
M  src/features/crm-tasks/Tasks.tsx

$ git diff --name-only 8118b12cca5f05892e1418c254818268795694e8..HEAD | rg -v '^(src/features/crm-tasks/Tasks\.tsx|src/features/crm-tasks/Tasks\.priority\.test\.tsx)$'
# no output; exit 1 means zero outside-grant paths
```

The production diff is limited to priority presentation and the existing
control in `Tasks.tsx`. The only other implementation file is the new focused
test. `taskExtensionRegistry.tsx`, action/template contracts, stores, types,
CRM Home, client/matter selection, workflows, shell/routing, flags, locales,
native/Rust, and migrations are unchanged.

## Self-review and independent review

Self-review completed once. It caught and removed an initial raw-red treatment
because the Lantern design system reserves red for errors and destructive
actions. The final badge uses existing warning, neutral, and local/calm tokens,
while words and shapes remain authoritative.

Independent review verdict: **PENDING, coordinator-owned.** Per the 2026-07-18
coordinator delta, the coordinator arranges the different-model independent
review; the builder did not self-appoint or claim that review.

WORKER-DONE: v1/task-priority-parity ready for review
