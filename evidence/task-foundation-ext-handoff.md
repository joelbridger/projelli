# Task foundation public-doorway extension

## Bound code and receipt

- Final code commit: `4d5a47322509e8450d09f891a3981b0e452b8754`
- Machine receipt: `evidence/self-check-receipt-4d5a47322509.txt`
- Receipt result: `overall: GREEN`
- Approved extension base: `653867304b33e871dbac2de9196c367343308564`
- Push, merge, and Cargo: **not run**

## Additive result

- Task actions now receive the canonical `tasks` and `workflowWorkItems`
  arrays already supplied to the Tasks screen.
- `TaskActionContext` and `TaskActionDescriptor` are available from
  `@/features/crm-tasks`.
- `CrmWorkflowWorkItem` is available from `@/features/crm-home`.
- The existing `workflowStepExtensionRegistry` is available from
  `@/features/crm-workflows`.
- The work-management paved-path skill documents the single-descriptor
  workflow-step registry append.
- No store, persistence path, behavior, registry order, or compatibility
  descriptor changed.

## Final-code checks

- Typecheck: PASS.
- Test typecheck: PASS.
- Foundation plus affected focused suite: PASS — 16 files, 83 tests.
- Feature-boundary check: PASS — no regression.
- Handle guard: PASS.
- Architecture boundary guard: PASS.
- English language snapshot guard: PASS.
- Touched-file ESLint: PASS — zero errors; only pre-existing warnings.
- Machine changed-code gate and repeated receipt checks: `overall: GREEN`.

## Attestations

1. **Fresh checks:** every reported final-code result was run after the last
   code edit and against `4d5a47322509e8450d09f891a3981b0e452b8754`.
   `[attest: yes + 4d5a47322509e8450d09f891a3981b0e452b8754]`
2. **Scope:** every product touch is one of the explicitly authorized public
   indexes, task-action context/threading files, paved-path documentation, or
   their seam-owned tests; this file and the receipt are evidence only.
   `[attest: yes]`
3. **Guard integrity:** no test, guard, assertion, type, timeout, snapshot,
   baseline, or manifest was weakened, and no suppression was added.
   `[attest: yes]`
4. **Contracts:** exports are additive and minimal; task-action data comes
   directly from the canonical screen inputs, and cross-feature consumers use
   only the public feature indexes.
   `[attest: yes]`
