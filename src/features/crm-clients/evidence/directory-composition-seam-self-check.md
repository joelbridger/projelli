# Directory composition seam self-check receipt

Code-and-proof commit: `e60e78f5d` (`fix(crm): isolate directory query records`)

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

$ npx vitest run src/features/crm-clients/directoryComposition.test.tsx
Test Files  1 passed (1)
Tests       7 passed (7)
exit status: 0

$ npx vitest run src/features/crm-clients/directoryRegistry.test.tsx src/features/crm-clients/crmClients.test.tsx src/features/crm-clients/clientMapEntryPoints.test.tsx src/features/crm-clients/ClientsSurface.scopeUpdate.test.tsx
Test Files  4 passed (4)
Tests       34 passed (34)
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

The focused suite checks the complete fixed base-era mount shape and record
order in both the default Directory and Whole book states when no feature
contributes anything. Its reversed fixtures make a missing sorter fail, and a
separate filter test proves filtering is invoked while preserving survivor
order. It also includes a real preference save followed by a fresh store
instance loading the saved value, view replacement and inactive-view fallback,
and mutation attempts from both a filter predicate and sort comparator. Those
callbacks try to rewrite both their projected results and their context record
collections; the source array and every visible card remain unchanged.

## Attestation

- The seam has no feature flag; consuming features supply their own activation.
- Sort and filter callbacks receive deeply read-only result records and deeply
  read-only context record collections. Runtime copies isolate the caller even
  if feature code deliberately bypasses the type contract. Their projections
  can change visible inclusion and order, but no stored CRM record is reordered
  or rewritten.
- All new cross-feature-facing contracts are exported through
  `@/features/crm-clients` and the boundary check is green.
- No matter/Matter/matter_id name was changed.
- No Cargo command, full gate, push, merge, deploy, or real-client-data action
  was run.

During development, the repository-wide parser command `npm run i18n:check`
reported its existing dynamic-key warnings. The project gate marks that parser
scan report-only under `KNOWN-I18N-01`; the blocking English snapshot and locale
completeness checks above both pass.
