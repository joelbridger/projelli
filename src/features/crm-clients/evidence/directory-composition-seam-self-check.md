# Directory composition seam extension repair receipt

Code-and-proof commit: `c21fc0cd0` (`fix(crm): scope directory feature state ports`)

Final checked tree: the commit containing this receipt. This receipt is the
only change after the code-and-proof commit above.

The worktree's declared `pdf-lib` and `fast-check` packages were restored
before the final type checks. They had been absent from its installed
dependencies; neither package manifest nor lockfile changed.

## Required checks

```text
$ npm run typecheck
exit status: 0

$ npm run typecheck:tests
exit status: 0

$ npm run boundaries:check
No feature-boundary regression (64 current baseline finding(s)).
exit status: 0

$ npx vitest run [every src/features/crm-clients/**/*.test.ts(x) file]
Test Files  13 passed (13)
Tests       91 passed (91)
exit status: 0

$ npx eslint [all 9 touched CRM TypeScript/TSX files] --max-warnings 0
exit status: 0
```

The full app-wide `node scripts/eslint-gate.mjs` was also run. It reported no
remaining finding in this lane after the local fixes, but it remains red for
pre-existing, unrelated in-progress `src/platform/docusignSigning/` findings.
Those files are outside this lane and were not changed.

## LANDED-CONTRACT NOTE

- Each `DirectoryContribution` declares one unique namespace. Composition
  rejects duplicate ownership. Its tools, views, and queries receive a state
  port already bound to that namespace: `get()` and `set(value)` have no key
  argument, so a feature cannot type an attempt to read another feature's
  state. The proof test exercises two independent ports, includes that
  type-level rejection, and checks the duplicate-namespace runtime failure.
- The host keeps those short-lived values private to one mounted directory and
  never persists them. Setting a feature's port re-renders the surface, so its
  `isActive`, `filter`, and `compare` callbacks see the current value.
- Only the resolved active view is mounted. A registered inactive view now
  leaves the no-contribution directory `innerHTML` byte-identical.
- `CrmPerson` and `HouseholdDirectoryEntry` expose optional `createdAt` and
  `updatedAt`; the live CRM adapter preserves either timestamp only when the
  canonical source record has it. Matter-backed fallback households preserve
  their existing `createdAt` only.
- `tags` are passed through only when the canonical household/person payload
  supplies them. `lastActivityAt` is derived only from canonical
  `activityEvent.at`: household events match `householdId`, and person events
  must directly target that person. No missing tag or activity value is
  invented.
- All cross-feature-facing contracts are exported through
  `@/features/crm-clients` and the boundary check is green.
- No Cargo command, full gate, push, merge, deploy, or real-client-data action
  was run.
