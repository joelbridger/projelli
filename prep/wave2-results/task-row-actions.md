# WB-047 honest task-row actions result

## Evidence binding and lane state

- Branch: `v1/task-row-actions`
- Coordinator-approved base: `0c52240a7ddb01590b405d30a543571afa6cfc8f`
- Launcher start: `cf582243a80dd5ff64ab112b931219df620c4018`
- Base-alignment merge: `8aa285810`
- Last code tip, and the exact tree checked:
  `24bdbe5e26e47c3e9d753793f0be2c5e4b29b229`
- Final evidence tip: the commit containing this report and the machine receipt
- Commits after the last code tip: evidence only
- Final worktree state: clean after the evidence commit
- Rust/native work: **NO**
- Pushed/merged into the combined branch: **NO/NO**

The launcher started the earlier blocked lane at `cf582243a`, while the
coordinator named `0c52240a` as the current combined base. The lane first
merged that combined base without discarding the historical blocker evidence.
The landed canonical removal seam at `cb384942a` is therefore an ancestor of
the checked code tip.

This follows the ruled evidence convention. All reported code checks bind to
the exact last code tip above. Only this report and the machine receipt are
added after that code tip.

## Outcome

Every ordinary task row now has three visible, plain-word controls:

- **Edit** opens the existing real Task detail editor. Saving still uses the
  existing canonical update behavior.
- **Duplicate** reads the full source from the public `TaskRecordStore`, creates
  a new task through `TaskRecordStore.create`, forces the new task to `open`,
  receives a fresh canonical ID, and opens that new task in the existing editor.
- **Delete** opens the shared in-app confirmation. Acceptance calls only
  `TaskRecordStore.remove(id)`, which moves the canonical task into the shared,
  restorable CRM Trash and reloads the live reader.

Workflow work items keep their separate completion-only row. They do not gain
task Edit, Duplicate, or Delete controls.

There is no local deleted list, row-only filter, status disguise, hard delete,
alternate task store, copied record writer, or CRM-home deep import.

## Canonical-writer preflight

The preflight passed after the combined base was aligned:

1. The public `useTaskRecordStore()` exposes `get`, `create`, `update`, and the
   newly landed `remove(id)` doorway.
2. `create` generates a fresh `task-${crypto.randomUUID()}` identity, writes
   through the canonical encrypted live-record save route, then reloads.
3. `remove(id)` resolves the real stored task and its matter scope, calls only
   `softDeleteCrmRecord`, which invokes `crm_trash_soft_delete`, then reloads.
4. The landed removal integration proves Trash restore through a fresh reader.
5. The new row-action integration proves source, duplicate, rejected deletion,
   accepted deletion, and post-unmount fresh-reader state are distinguishable.

The fire-time protected-path scan returned `scan_exit=1`, which is the expected
zero-match result for the granted task attachment points.

## Durable duplicate and delete evidence

`Tasks.rowActions.live.test.tsx` drives the real task screen over the canonical
Tauri command boundary.

It proves that Duplicate:

- starts from a completed source but creates an open task;
- gives the duplicate a different ID;
- preserves title, notes, client relation, assignee, due date, due time,
  recurrence, priority, category, tags, and document relations;
- leaves the source record byte-for-byte unchanged;
- opens the real editor and saves through its existing Save control; and
- survives unmount and a fresh `crm_live_list` reader with both records present.

It proves that Delete:

- shows restore-aware confirmation copy;
- performs no Trash call when Cancel is chosen;
- preserves the rejected deletion through unmount and fresh reload;
- invokes `crm_trash_soft_delete` only after Delete is confirmed;
- leaves the deleted task in recoverable Trash; and
- removes it from a fresh task reader while the source remains unchanged.

The landed `taskRemoval.live.test.tsx` separately proves that a removed task can
be restored from Trash and read again through the public stores.

## Accessibility proof

- Edit, Duplicate, and Delete are native buttons with visible text.
- The row action group has the accessible name `Actions for <task title>`.
- Each button has a distinct accessible name containing both its action and the
  task title.
- The focused test moves keyboard focus to Edit and opens the real editor.
- Delete uses the shared Radix-based alert dialog, with labelled Cancel and
  Delete buttons and destructive styling.
- Priority and workflow-row behavior remain unchanged. Workflow rows have no
  task action group.

## Fresh final checks at `24bdbe5e26e47c3e9d753793f0be2c5e4b29b229`

- `npm run typecheck`: **PASS**, exit 0.
- `npm run typecheck:tests`: **PASS**, exit 0.
- Focused row/store/removal suite: **PASS**, 9 files and 25 tests.
- `npm run boundaries:check`: **PASS**, no regression against 599 current
  baseline findings.
- `npx vitest run tests/unit/architecture-boundaries.test.ts`: **PASS**, 1 test.
- `node scripts/ui-system/handle-guard.mjs`: **PASS**, no permanent handle
  vanished and no new ambiguous handle.
- `npx vitest run tests/unit/i18n/en-json-snapshot.test.ts`: **PASS**, 5 tests.
- ESLint on every touched TS/TSX file: **PASS**, exit 0. It reports two existing
  `lantern-async/no-silent-failure` warnings in the pre-existing Save view and
  Task detail Save handlers; this lane adds no warning, suppression, or waiver.
- Prettier check on every touched TS/TSX file: **PASS**.
- `git diff --check 0c52240a..HEAD`: **PASS**.
- Protected-path whole-tree attachment scan: **PASS**, expected
  `scan_exit=1` zero-match result.

The machine receipt reran the standard checks with a longer per-step safety
window because the repository's changed-area suite exceeded its default five
minutes. The conclusive run is:

- Receipt: `evidence/self-check-receipt-24bdbe5e26e4.txt`
- Bound SHA: `24bdbe5e26e47c3e9d753793f0be2c5e4b29b229`
- Base: `0c52240a7ddb01590b405d30a543571afa6cfc8f`
- `gate:changed`: **PASS**, changed gate green, 9,195 tests with 29 skipped
- Receipt-focused `src/features/crm-tasks`: **PASS**, 23 files and 73 tests
- Overall: **GREEN**

The earlier five-minute receipt attempt was truthfully inconclusive and was
replaced, unedited, by the conclusive machine-generated receipt for the same
code tip.

## Review result

- Builder self-review: **PASS**. The adversarial read checked for a second
  writer, hard-delete marker, local hiding, field loss, source mutation,
  workflow-row spillover, and inaccessible controls. None was found.
- Independent Sol review: **coordinator-arranged and not claimed by this lane**,
  as directed in the coordinator deltas.

## Product and contract decisions

- Duplicate copies only the canonical task's ordinary editable fields.
- Duplicate always creates an open task with a fresh identity.
- Duplicate reads the canonical source first instead of trusting the thinner
  display projection, so document and client relations are retained.
- Delete means move to recoverable Trash for 30 days, not permanent deletion.
- Delete is rejected unless the user accepts the in-app confirmation.
- Edit continues to use the existing editor and save route.
- No extension registry or CRM-home contract change was needed.

## Attestations

1. **Fresh checks:** every reported final code check ran after the last code
   edit against the exact checked code tip.
   `[attest: yes + 24bdbe5e26e47c3e9d753793f0be2c5e4b29b229]`
2. **Scope:** every changed path is authorized: `Tasks.tsx`,
   `Tasks.actionContext.test.tsx`, the directly adjacent
   `Tasks.rowActions.live.test.tsx`, this result, and the current/historical
   machine receipts.
   `[attest: yes | task-row action source, focused tests, result, receipts]`
3. **Guard integrity:** no test, validation, type, timeout, snapshot, baseline,
   manifest, assertion, skip, only, or suppression was weakened.
   `[attest: yes | no exception]`
4. **Contracts:** production code uses only the public canonical task store. No
   second task persistence route or deep cross-feature import exists.
   `[attest: yes]`

The launcher alone owns the completion sentinel.
