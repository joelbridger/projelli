# Directory composition seam extension receipt

Code-and-proof commit: `7f3be5ab7` (`feat(crm): extend directory composition seam`)

Final checked tree: the commit containing this receipt. This receipt is the
only change after the code-and-proof commit above.

## Required checks

```text
$ npm run typecheck
exit status: 0

$ npm run typecheck:tests
exit status: 0

$ npm run boundaries:check
No feature-boundary regression (64 current baseline finding(s)).
exit status: 0

$ npx vitest run src/features/crm-clients/directoryComposition.test.tsx src/features/crm-clients/directoryRegistry.test.tsx src/features/crm-clients/ClientsSurface.scopeUpdate.test.tsx src/features/crm-clients/extensions/bulk-select/bulkSelect.test.tsx
Test Files  4 passed (4)
Tests       28 passed (28)
exit status: 0

$ npx vitest run --maxWorkers=1 --no-file-parallelism [every src/features/crm-clients/*test.ts(x) file]
Test Files  26 passed (26)
Tests       91 passed (91)
exit status: 0

$ npx eslint src/features/crm-clients/DirectorySurface.tsx src/features/crm-clients/directoryRegistry.tsx src/features/crm-clients/directoryComposition.test.tsx --max-warnings 0
exit status: 0
```

The full app-wide `node scripts/eslint-gate.mjs` was also run. It reported no
remaining finding in this lane after the local fixes, but it remains red for
pre-existing, unrelated in-progress `src/platform/docusignSigning/` findings.
Those files are outside this lane and were not changed.

## Attestation

- `DirectoryContext.featureState` is required, local to one mounted directory,
  and namespaced by the consuming feature. It is not persisted and does not use
  a global store or event bus. A feature tool's `set` re-renders the surface,
  allowing `isActive`, `filter`, and `compare` to read the current state.
- `DirectoryComposition` now accepts additive feature `tools`, so feature
  controls and their query descriptors compose through the public seam.
- `CrmPerson` and `HouseholdDirectoryEntry` expose optional `createdAt` and
  `updatedAt`; the live CRM adapter preserves either timestamp only when the
  canonical source record has it. Matter-backed fallback households preserve
  their existing `createdAt` only.
- Legacy directory behavior with no contributions is still covered by its
  fixed mount-shape test.
- All cross-feature-facing contracts are exported through
  `@/features/crm-clients` and the boundary check is green.
- No Cargo command, full gate, push, merge, deploy, or real-client-data action
  was run.
