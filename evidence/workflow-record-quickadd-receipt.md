# Workflow record quick-add receipt

## Bound code

- Final code commit: `519219be6c3ed2580aef7c45e597229fc763beab`
- Landed base re-checked: `cb09c8c4f9767f1334bedd381fe0f28f0018a2f3`
- Rust/native touched: **NO**
- Screenshots or other evidence artifacts: **NO**

## Seam check

All named seams exist at the landed base and are used without private adapters:

- The legacy household `workflow` action still sends the real `kind`, household
  identity, and label through the CRM-home request route.
- `AppSurfaceRouter` retains the one-shot route lifecycle and consumption
  callback.
- `CrmHomeSurfaceContext` and the landed `LiveWorkflows` composition pass that
  request to `WorkflowRecordStartSlot`.
- The public `@/features/crm-workflows` doorway supplies the canonical template
  store, typed `WorkflowTemplateError`, record-start descriptor types, the
  record-start registry mount, and the sanctioned template-library action.
- The quick-add descriptor is appended once to
  `workflowRecordStartRegistry`; it mounts only through the public record-start
  slot.

`Workflows.tsx` was not changed. The former shared-host exception was withdrawn
by the coordinator amendment, so there is no shared-host exception to record.

## Coverage

- The new off-by-default `workflow-record-quickadd` flag stops before any store
  read, template list, start call, request consumption, or visual wrapper.
- A record request lists the canonical templates, shows drafts as unavailable,
  starts a published template once with the exact normalized household, and
  consumes only after the canonical start resolves.
- Cancel consumes without a write. A typed failed start keeps the form and
  request usable. The no-published-template path calls the sanctioned library
  action rather than guessing a route.
- The live handoff test writes through `crm_live_upsert`, unmounts the writer,
  mounts a fresh canonical reader, and proves the new instance through the
  later `crm_live_list` reload boundary.

## Checks

- PASS — `npx tsc --noEmit`
- PASS — `npx tsc -p tsconfig.test.json --noEmit`
- PASS — focused Vitest: record quick-add, record-start slot, workflow authoring
  lifecycle, router CRM-add, and public authoring doorway tests.
- PASS — `npm run boundaries:check` (no new boundary regression; 64 existing
  baseline findings remain).
- PASS — architecture boundaries and English locale snapshot: 2 files, 6 tests.
- PASS — `node scripts/ui-system/handle-guard.mjs`
- PASS — `node scripts/ui-system/token-guard.mjs`
- PASS — `npm run i18n:completeness` (53 catalogs, 3502 keys).
- PASS — `npm run lint:gate`
- RED, recorded once without retry — full `npx vitest run` reached the unrelated
  intake-page build and stopped because the shared dependency install lacks
  `pdf-lib` (`src/pdfFill/preparePdfFillSubmission.ts`, PDF fixtures, and
  `tests/pdf-fill.spec.ts`). No quick-add source or test was implicated.

## Attestations

1. Fresh checks above are bound to the final code commit
   `519219be6c3ed2580aef7c45e597229fc763beab`. `[attest: yes]`
2. The product changes are the flag-gated record quick-add package, its one
   public registry contribution, and its required flag line. `[attest: yes]`
3. No guard, timeout, baseline, test, or contract was weakened. `[attest: yes]`
