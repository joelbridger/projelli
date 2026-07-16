# Workflow authoring extension 2 fix handoff

## Bound code and evidence

- Final code commit: `ad591dd0d9c7c182484a60e7ad38ed268f99aae1`
- Approved additive base: `c734322bd229500888d35e826becfccd00871e21`
- Machine receipt: `evidence/self-check-receipt-ad591dd0d9c7.txt`
- Receipt result: `overall: GREEN`
- Push, merge, Cargo, native, and Rust work: **not run**

## Finding 1: the lane no longer widens the shared host

`src/features/crm-workflows/Workflows.tsx` is byte-for-byte unchanged from the
approved base. This lane exports and proves `WorkflowRecordStartSlot`, but does
not import or render it in the shared host.

The coordinator owns the host composition at merge. It must add the public
slot import and this single composition line to `LiveWorkflows`:

```tsx
import { WorkflowRecordStartSlot } from './authoring/WorkflowRecordStartSlot';

<WorkflowRecordStartSlot {...(addRequest ? { addRequest } : {})} households={households} {...(onAddRequestConsumed ? { onAddRequestConsumed } : {})} {...(template ? { templateId: template.id } : {})} />
```

That is the only coordinator composition needed. Dependents still register a
descriptor through the public registry and do not edit `Workflows.tsx`. This
lane requests no exception to the protected-host rule.

## Finding 2: intake hosting build is green

The build failure was caused by
`intake-page/scripts/copy-pdf-worker.mjs` assuming `pdfjs-dist` was installed in
`intake-page/node_modules`. In this worktree npm hoists that dependency to the
repository's top-level `node_modules`, so the hard-coded source path did not
exist.

The script now uses Node's package resolver. It therefore finds the worker in
both supported layouts: a standalone intake-page install and a hoisted root
install. The intake-page production build and all six
`tests/security/intake-hosting.test.ts` tests passed directly before the code
commit, and the same build/test path passed again inside the receipt's full
changed-files gate.

## Verification

The fresh receipt is bound to the final code commit and records:

- Changed-files gate: PASS — 1,069 files passed, 3 skipped; 8,627 tests passed,
  29 skipped; `CHANGED GATE GREEN`.
- Typecheck: PASS.
- Test typecheck: PASS.
- Handle guard: PASS.
- Architecture boundary guard: PASS.
- English language snapshot: PASS — 5 tests.
- Focused suite: PASS — 5 files / 18 tests, including the intake-hosting suite,
  public workflow doorway, record-start slot, authoring mount, and canonical
  lifecycle.
- Rust packages were not selected; Cargo was not run.

## Attestations

1. **Fresh checks:** the final receipt was generated after the last code edit
   and is bound to `ad591dd0d9c7c182484a60e7ad38ed268f99aae1` and its exact
   tree. `[attest: yes + ad591dd0d9c7c182484a60e7ad38ed268f99aae1]`
2. **Scope:** every product change is either the authorized public
   workflow-authoring slot/docs or the specifically requested intake-hosting
   build repair; `Workflows.tsx` is unchanged from the approved base. This
   handoff and the receipt are evidence only. `[attest: yes]`
3. **Guard integrity:** no test, guard, assertion, timeout, snapshot, baseline,
   or manifest was weakened, and no suppression was added. `[attest: yes]`
4. **Contracts:** the workflow exports remain additive, existing descriptor
   shapes and behavior are preserved, the dark/default slot remains empty,
   and the intake fix changes only dependency-file discovery without changing
   page, hosting, or integrity behavior. `[attest: yes]`
