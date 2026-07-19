# WB-048 supplied task-list print result

## Evidence binding and lane state

- Branch: `v1/task-list-print`
- Coordinator-approved base: `0c52240a7ddb01590b405d30a543571afa6cfc8f`
- Verified launcher/combined start: `6c22f1299d6be46a545eb329adfc0de4ae3c92a4`
- Last code tip, and the exact tree checked:
  `1b27c3d1a17ac1b41463f925baef5aa2eb995979`
- Final evidence tip: the commit containing this report and the machine receipt
- Commits after the last code tip: evidence only
- Final worktree state: clean after the evidence commit
- Pushed/merged: **NO/NO**
- Rust/native work: **NO**

The launcher started from the newer combined tip, which is a descendant of the
approved fire base. No history was discarded. All code checks bind to the exact
last code tip above; only this report and the machine receipt follow it.

## Outcome

PASS. The real Tasks toolbar now mounts exactly one accessible **Print task
list** action through the existing append-only task-action registry.

A direct click opens one blank browser/OS print window synchronously, builds a
light print page, focuses it, and calls its print dialog. The app does not save,
download, export, archive, update, complete, delete, or re-query anything. The
user's printer or PDF choice remains entirely inside the operating-system print
dialog.

The page is titled **Current task list**. Its record count is exactly:

```text
context.tasks.length + context.workflowWorkItems.length
```

Tasks print first in their supplied order, followed by workflow work items in
their supplied order. Each row contains only these supplied facts or a truthful
absence label derived from them:

- supplied title;
- kind: Task or Workflow step;
- supplied status, displayed as a localized label;
- supplied assignee label, otherwise the supplied assignee ID, otherwise
  Unassigned; and
- supplied due label/date and task due time, otherwise No due date.

The zero-record page says that no tasks or workflow steps were supplied. No
private search state, selection, client record, store data, compatibility mount,
or other toolbar content enters the print document.

## Print-contract preflight

The hard-stop preflight passed before implementation:

1. `TaskActionContext` already exposes read-only `tasks` and
   `workflowWorkItems` arrays.
2. `Tasks.tsx` already passes those exact input references to
   `mountTaskActions()`.
3. A feature-local descriptor mounts through `taskActionRegistry` without a
   context/type change.
4. `window.open('about:blank', ...)` can run synchronously inside the existing
   React button click contract, before any await or background work.
5. The protected-path safety grep against the task registry and Tasks screen
   returned the expected zero-match result: `safety_grep_exit=1`.

The implementation therefore needed no extra context field, task store,
selection data, document editor/writer, native command, Meetings/Calendar
surface, router, shell, persistence, or migration change.

## User-gesture, failure, and safe-DOM proof

The focused test mounts the action from the real registry, clicks its accessible
button, and proves one `window.open`, one focus, and one print call. There is no
promise, timer, import, or other delayed hop between the user click and the
popup call.

When the popup is blocked, the app shows:

> The print window could not open. Allow popups and try again.

When document construction or printing throws, the app closes the failed popup
when possible and shows a separate truthful print-dialog error. Neither path
claims that a print or PDF was made.

The print helper uses only `createElement`, attributes, static CSS, and
`textContent`. It does not use `innerHTML`, `document.write`, DOM parsing,
`dangerouslySetInnerHTML`, or string-to-DOM insertion. The adversarial test
supplies apparent `<img onerror>` and `<script>` text in task/assignee values,
then proves that the literal text prints while no image or script element
exists. Frozen input arrays and objects remain byte-for-byte and reference
identical after printing.

## Fresh final-code checks at `1b27c3d1a17ac1b41463f925baef5aa2eb995979`

- `npm run typecheck`: **PASS**, exit 0.
- `npm run typecheck:tests`: **PASS**, exit 0.
- Focused print + task-registry Vitest: **PASS**, 2 files and 8 tests.
- `npm run boundaries:check`: **PASS**, no regression against 599 current
  baseline findings.
- `npx vitest run tests/unit/architecture-boundaries.test.ts`: **PASS**, 1 test.
- `node scripts/ui-system/handle-guard.mjs`: **PASS**, no permanent handle
  vanished and no new ambiguous handle.
- `npx vitest run tests/unit/i18n/en-json-snapshot.test.ts`: **PASS**, 5 tests.
- ESLint on every touched TS/TSX file: **PASS**, exit 0 with no output.
- `git diff --check 0c52240a7ddb01590b405d30a543571afa6cfc8f..HEAD`:
  **PASS**, exit 0.
- Receipt `gate:changed`: **PASS**, changed gate green; 9,199 tests with 29
  skipped by the existing suite.

Machine receipt:
`evidence/self-check-receipt-1b27c3d1a17a.txt`

The default five-minute receipt attempt was truthfully inconclusive under
shared machine load and was replaced, unedited, by the conclusive run for the
same code SHA with a ten-minute per-step safety window. Every receipt step is
`PASS`, and its final verdict is `overall: GREEN`.

## Review result

- Builder self-review: **PASS**. The adversarial read checked registry-only
  mounting, direct user-gesture timing, supplied-data-only rendering, record
  count, mixed task/workflow labeling, absent-value wording, popup failure,
  safe DOM construction, source mutation, and alternate writers/readers. No
  remaining issue was found.
- Independent Sol review: **coordinator-arranged and not claimed by this lane**,
  as directed by the coordinator delta.

## Product and contract decisions recorded

1. The action is plainly named **Print task list** and appears only in the
   existing Tasks toolbar registry. No menu, shell item, or second toolbar was
   added.
2. **Current task list** means exactly the task/workflow arrays supplied to the
   public task-action context, not the screen's private search state or a store
   query.
3. The displayed supplied-record count includes both task and workflow-step
   rows.
4. Opening the operating-system/browser print dialog completes the app action.
   The app does not claim to save a PDF or durable export.
5. Popup or print failure is visible and truthful. There is no off-gesture or
   background retry.
6. Missing assignee/due values receive explicit absence labels; no client,
   assignment, date, status, or other record value is guessed.

## Attestations

1. **Fresh checks:** every reported final code check ran after the last code
   edit against the exact checked code tip.
   `[attest: yes + 1b27c3d1a17ac1b41463f925baef5aa2eb995979]`
2. **Scope:** every touched path is authorized: the feature-local
   `src/features/crm-tasks/extensions/print/` package, the single append-only
   registry import/entry, the exact registry-order assertion required by the
   focused task-registry check, this result, and the machine receipt.
   `[attest: yes | print extension, append-only registry entry, exact registry test, result, receipt]`
3. **Guard integrity:** no test, validation, type, timeout, snapshot, baseline,
   manifest, assertion, skip, only, or suppression was weakened or added.
   `[attest: yes | no exception]`
4. **Contracts:** production code reads only the supplied task-action context
   and introduces no writer, exporter, store reader, selection route, document
   route, or native route.
   `[attest: yes]`

The launcher alone owns the final completion marker.
