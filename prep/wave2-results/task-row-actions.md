# WB-047 task-row actions preflight result

COORDINATOR: The required canonical task delete/remove route is absent at the
approved base. `TasksSurface` can call only
`adapter.actions.updateTask`; `CrmHomeActions` exposes no task remove, archive,
or delete callback; the public `TaskRecordStore` exposes only `get`, `create`,
and `update`; and the live-record doorway exposes only list and upsert. Adding
the missing route would require changing fenced CRM-home/task persistence
contracts. The brief requires a hard stop before implementation, so WB-047 is
blocked and no row actions were added.

## Lane state

- Branch: `v1/task-row-actions`
- Verified launch base: `a197c9c2073f1b561070db9be52d6a7f35f4847d`
- Final tip and clean-state proof: recorded by the launcher after this evidence
  commit and its machine receipt
- Pushed/merged: no/no
- Rust/native work: NO
- Build attempt spent: NO; this is the required zero-attempt preflight stop

## Canonical-writer preflight

The visible ordinary row opens `TaskDetail` and saves through
`Tasks.onUpdateTask`. In the mounted product surface that becomes
`adapter.actions.updateTask`, whose live implementation calls `saveTask`,
`mergeCrmTaskRecord`, and the canonical `crm_live_upsert` writer. That writer is
followed by the existing live-record reload path. Existing focused tests prove
that create/update data survives an unmount and a fresh `crm_live_list` reader.

The public task store can also create a task with a fresh
`task-${crypto.randomUUID()}` identity through the same upsert/reload boundary.
This means the source and a duplicate could be durably distinguished. However,
the existing `TaskActionContext` carries task snapshots and a compatibility
mount only; it carries none of the canonical create, update, or remove
callbacks required by the optional owned row-actions package.

Delete fails the mandatory preflight at every public layer:

1. `Tasks` accepts `onUpdateTask`, but no remove/archive/delete callback.
2. `TasksSurface` receives `adapter.actions.updateTask`, but
   `CrmHomeActions` defines no canonical task removal action.
3. `TaskRecordStore` defines `get`, `create`, and `update`, but no removal or
   archive operation.
4. `liveRecords.ts` exposes only `crm_live_list` and `crm_live_upsert`; the
   registered CRM live commands likewise provide list/upsert, not a public
   remove operation.

Writing `deleted: true`, changing status to `cancelled`, filtering the row
locally, or deep-importing CRM-home internals would invent the forbidden
deletion semantics. A fresh reader therefore cannot prove a real deleted or
archived state using an already-authorized route.

## Safety and scope evidence

The fire-time slate safety grep was rerun against the three named attachment
points and returned `grep_exit=1`, meaning no protected activation/R3-table
path matched. The whole-tree writer scan found task create/update through the
canonical upsert/reload path and no public task remove/archive/delete contract.

Changed-path scope is limited to this granted result file. No production code,
test, locale, registry, contract, store, shell, App, client/matter selection,
workflow, Rust, migration, snapshot, baseline, manifest, timeout, assertion,
or suppression changed.

## Acceptance and review result

- Edit: existing canonical behavior confirmed; unchanged.
- Duplicate: a durable canonical create route exists, but the full three-action
  outcome is atomic and Delete failed preflight; no partial UI was added.
- Delete: BLOCKED because no already-existing public canonical route exists.
- Confirmation/rejection and fresh-reader deletion proof: not runnable without
  inventing or expanding a fenced contract.
- Accessibility proof: not applicable because showing incomplete or fake row
  actions is forbidden.
- Self-review: PASS for the required hard stop; no implementation diff exists.
- Independent Sol review: coordinator-arranged; not claimed here.
- Receipt: the machine-generated self-check receipt is committed separately
  after this preflight result, per the ruled binding convention.

## Product and contract decisions

No new product or contract decision was made. The lane followed the settled
rule that Delete must use an existing canonical remove/archive route and that
the three actions must not be shipped partially. The coordinator must first
grant and land a canonical removal contract, including its durable fresh-reader
meaning, before WB-047 can resume.

## Attestations

1. Fresh checks: the preflight and safety scans were rerun after the final
   evidence edit; the exact checked SHA is bound by the machine receipt.
   `[attest: yes + receipt SHA]`
2. Scope: the only touched path is the explicitly granted
   `prep/wave2-results/task-row-actions.md`.
   `[attest: yes | result receipt authorization]`
3. Guard integrity: no test, validation, type, timeout, snapshot, baseline, or
   manifest changed.
   `[attest: yes | no exception]`
4. Contracts: no second task persistence route or deep cross-feature import was
   added.
   `[attest: yes]`
