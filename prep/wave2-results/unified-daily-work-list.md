# WB-040 truthful unified daily work list result

## Evidence binding and lane state

- Branch: `v1/unified-daily-list`
- Brief's registered base: `0c52240a7ddb01590b405d30a543571afa6cfc8f`
- Coordinator/launcher combined base actually supplied:
  `6c22f1299d6be46a545eb329adfc0de4ae3c92a4`
- Base relationship: the registered base is an ancestor of the supplied base.
- Last code tip and exact tree checked:
  `b04ab3dd89a6cebf5911ccce78431c11929b48a5`
- Final evidence tip: the commit containing this result and the machine receipt.
- Commits after the last code tip: evidence only.
- Final worktree state: clean after the evidence commit.
- Pushed/merged: **NO/NO**.
- Rust/native work: **NO**.

The newer combined tip changed `Tasks.tsx` after the brief's registered base.
The lane therefore used the coordinator-supplied combined tip, preserved those
changes, and did not reset to the stale registered base.

## Outcome

The existing Tasks list now renders ordinary tasks and workflow steps through
one mixed row loop. It no longer renders every task first and every workflow
step second.

The list uses the existing daily-work ranking facts:

1. open and in-progress work comes before completed or cancelled work;
2. within open work, the existing ranker applies due urgency, blocked state,
   priority, due date, and title in its established order; and
3. completed and cancelled work follows in the canonical merged source order.

This is the brief's settled **PROPOSED expert-proxy default**. No estimates,
hours, date buckets, second planner, new status, or new ranker was invented.

The existing search still filters both task titles and workflow-step titles.
Its keyboard and screen-reader name remains `Search tasks`, preserving the
existing name and saved-view behavior required by the brief. In the mixed list,
ordinary rows visibly say `Task` and workflow rows visibly say `Workflow step`,
so kind is never communicated by colour alone.

The existing board remains task-only and unchanged. Empty-state, saved-view,
task-detail, duplicate, delete, edit, and capacity-triage behavior is unchanged
outside the mixed list rendering.

## Hard-stop preflight evidence

The preflight passed without a shared seam change:

1. A visible ordinary task reaches `TaskRow`, whose completion button calls
   `advance(task)`, which calls only the already-supplied `onUpdateTask` with
   the existing task and its toggled status.
2. A visible workflow step reaches `WorkflowWorkRow`, whose completion button
   calls only the already-supplied `onCompleteWorkflowWorkItem`.
3. `dailyWorkItems()` already returns the discriminated task/workflow union.
   Both sides already carry stable ID, title, status, priority, optional due
   date, and assignee ID. These are all fields the existing daily ranker needs.
4. The `item.kind === 'task'` guard chooses the renderer. Before an action is
   attached, the row resolves back to the original filtered task or workflow
   object. The display-only `kind` field is never sent to either callback.

No new shared type, CRM-home adapter, workflow registry, writer, persistence
route, selection reader, or shell contract was needed.

The fire-time safety grep against the supplied combined tip returned the
expected zero-match result. The R3 reader/writer table names neither granted
path. The same protected-path grep and a whole-diff path scan passed again on
the checked code tip.

## Callback proof

`Tasks.unifiedList.test.tsx` proves the two completion routes with exact source
objects:

- clicking the ordinary task completion button calls `onUpdateTask` exactly
  once with the original task fields and `status: 'done'`, and does not call
  the workflow callback;
- clicking the workflow-step completion button calls
  `onCompleteWorkflowWorkItem` exactly once with the original workflow item,
  and does not call the task callback; and
- the first red run caught a display-only `kind` field reaching the task
  payload. The renderer was corrected to resolve the original source object,
  and the strengthened exact-object assertion now passes.

No task action is routed through workflow completion, and no workflow action
is routed through task update.

## Ordering, filter, kind, and accessibility proof

The focused test proves:

- an overdue workflow step can rank ahead of an ordinary task;
- a future-due task, an undated high-priority task, and a blocked workflow step
  follow the existing due/blocked/priority rules;
- a completed ordinary task remains after all open mixed work;
- one search term leaves a matching task and matching workflow step together
  in the same list while excluding both nonmatches;
- every mixed row has a visible word label (`Task` or `Workflow step`);
- completion controls remain native buttons with their existing accessible
  `Complete <title>` names; and
- the search remains a native textbox with its existing accessible name.

Kind and priority remain readable words, not colour-only signals. No keyboard
control, accessible action name, snapshot, or interaction route was removed.

## Fresh checks on code tip `b04ab3dd89a6cebf5911ccce78431c11929b48a5`

Machine receipt:
`evidence/self-check-receipt-b04ab3dd89a6.txt`

- Receipt overall: **GREEN**.
- `npm run gate:changed`: **PASS**, 276 files and 276 tests passed.
- `npm run typecheck`: **PASS**.
- `npm run typecheck:tests`: **PASS**.
- `node scripts/ui-system/handle-guard.mjs`: **PASS**, no permanent handle
  vanished and no new ambiguous handle was added.
- `npx vitest run tests/unit/architecture-boundaries.test.ts`: **PASS**, 1
  test.
- `npx vitest run tests/unit/i18n/en-json-snapshot.test.ts`: **PASS**, 5 tests.
- `npm run boundaries:check`: **PASS**, no regression against 599 existing
  baseline findings.
- Receipt-focused `src/features/crm-tasks`: **PASS**, 24 files and 76 tests.
- `npx eslint` on both touched TS/TSX files: **PASS**, exit 0 with two existing
  `lantern-async/no-silent-failure` warnings in untouched handlers at
  `Tasks.tsx:339` and `Tasks.tsx:959`; this lane added no warning, waiver, or
  suppression.
- Prettier check on both touched TS/TSX files: **PASS**.
- `git diff --check 6c22f129..HEAD`: **PASS**.
- Final whole-diff protected-path scan: **PASS**; the code-tip diff contains
  only `Tasks.tsx` and `Tasks.unifiedList.test.tsx`.
- Final attachment safety grep: **PASS**, expected zero matches.

The required checks ran after the last code edit and against the exact code tip
above. The result and receipt are evidence-only additions after that tip.

## Review result

- Builder self-review: **PASS**. The adversarial read checked the discriminant,
  completed/cancelled placement, due/blocked/priority ordering, duplicate IDs
  by kind, empty/search/saved-view/board behavior, exact task payload, exact
  workflow payload, accessible labels, and the no-shared-seam fence.
- Independent Sol review: **coordinator-arranged and not claimed by this lane**,
  as directed in the coordinator deltas.

## Product and contract decisions

- Adopted the brief's proposed expert-proxy order because the existing ranker
  works with the existing mixed union and needs no shared-helper change.
- Preserved completed and cancelled rows after open work rather than hiding
  them; their relative order stays the canonical merged source order.
- Added visible `Task` text so both row kinds have plain-word meaning.
- Preserved the search control's existing accessible name and action.
- Used the mixed union only for ordering and kind selection. Every action uses
  the original source record.
- Added no task action, workflow rule, store, adapter, type, persistence route,
  selection logic, shell route, flag, locale, native command, or migration.
- Did not touch `src/features/crm-home/shared/workItems.ts`, any Meetings or
  calendar-grid path, the selection-authority chain, or any F0-F13 surface.

## Attestations

1. **Fresh checks:** every reported final code check ran after the last code
   edit against the exact checked code tip.
   `[attest: yes + b04ab3dd89a6cebf5911ccce78431c11929b48a5]`
2. **Scope:** every touched path is authorized: `Tasks.tsx`, the directly
   adjacent `Tasks.unifiedList.test.tsx`, this result, and the machine receipt.
   `[attest: yes | screen list rendering, focused test, result, receipt]`
3. **Guard integrity:** no test, validation, type, timeout, snapshot, baseline,
   manifest, assertion, skip, only, or suppression was weakened.
   `[attest: yes | no exception]`
4. **Contracts:** no task/workflow writer, shared adapter, persistence route, or
   selection authority changed.
   `[attest: yes]`

The launcher alone owns the completion sentinel.
