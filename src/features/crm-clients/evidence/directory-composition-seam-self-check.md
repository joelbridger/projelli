# Directory composition seam self-check receipt

Code commit: `6b7d8f905` (`feat(crm): add directory composition seam`)

Final checked tree: the commit containing this receipt. This receipt is the
only change after the code commit above.

## Required checks

```text
$ npm run typecheck
exit status: 0

$ npm run typecheck:tests
exit status: 0

$ npm run boundaries:check
No feature-boundary regression (64 current baseline findings).
exit status: 0

$ npx vitest run src/features/crm-clients/directoryComposition.test.tsx src/features/crm-clients/directoryRegistry.test.tsx src/features/crm-clients/crmClients.test.tsx src/features/crm-clients/clientMapEntryPoints.test.tsx src/features/crm-clients/ClientsSurface.scopeUpdate.test.tsx
Test Files  5 passed (5)
Tests       39 passed (39)
exit status: 0

$ npx vitest run tests/unit/architecture-boundaries.test.ts
Test Files  1 passed (1)
Tests       1 passed (1)
exit status: 0

$ node scripts/ui-system/handle-guard.mjs
No permanent handle vanished and no new ambiguous handle was added (64 frozen).
exit status: 0

$ npx vitest run tests/unit/i18n/en-json-snapshot.test.ts
Test Files  1 passed (1)
Tests       5 passed (5)
exit status: 0

$ npm run i18n:completeness
30 catalogs and 3050 keys complete.
exit status: 0

$ node scripts/eslint-gate.mjs
No ESLint regression vs baseline (31 fingerprints cleaned up vs baseline).
exit status: 0
```

The focused suite includes a real preference save followed by a fresh store
instance loading the saved value. It also proves an inactive registered view
leaves the legacy directory in place, an active view replaces legacy cards,
sort and filter contributions compose, and the source record array stays in
its original order.

## Attestation

- The seam has no feature flag; consuming features supply their own activation.
- Sort and filter operate on a read-only projection. No stored CRM record is
  reordered or rewritten.
- All new cross-feature-facing contracts are exported through
  `@/features/crm-clients` and the boundary check is green.
- No matter/Matter/matter_id name was changed.
- No Cargo command, full gate, push, merge, deploy, or real-client-data action
  was run.

During development, the repository-wide parser command `npm run i18n:check`
reported its existing dynamic-key warnings. The project gate marks that parser
scan report-only under `KNOWN-I18N-01`; the blocking English snapshot and locale
completeness checks above both pass.
