# Directory composition seam extension fix 3 receipt

Code-and-proof commit: `aa8d035bda80582678b6f620feff71de6a304f86`
(`fix(crm): finalize directory seam contracts`)

The commands below were run against that exact code commit before this receipt
was written. The two TypeScript commands were run directly and unpiped; their
actual process exit codes are recorded below.

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

$ npx eslint [all 6 TypeScript/TSX files changed by fix 3] --max-warnings 0
exit status: 0

$ git diff --check
exit status: 0

$ rg "@ts-(expect-error|ignore)|ts-ignore" src/features/crm-clients
no matches
exit status: 1 (the expected ripgrep result when no suppression exists)
```

## Final contract notes

- `CrmPerson` and `HouseholdDirectoryEntry` expose optional canonical `tagIds`.
  Household projections copy `tagIds` only when the live canonical record has
  that field. Person projections preserve the embedded canonical `tagIds`.
  Missing sources omit the field; the adapter does not create `tags: []` and
  does not join or duplicate tag display names. Features needing names resolve
  them from canonical `Tag` records through the tags public doorway.
- `lastActivityAt` still comes only from real `ActivityEvent` fields:
  `at` plus household `householdId` or person `targetRef`. The optional value is
  computed once and omitted when no matching event exists.
- A stateless `DirectoryContribution` uses the ordinary directory context and
  needs no namespace. The test includes the existing contact-table pattern:
  a typed contribution containing only `views` and no namespace.
- A contribution requesting `featureState` must use the stateful descriptor
  surface and declare a namespace. Namespaces accept only lowercase letters,
  numbers, dots, or hyphens; duplicate ownership throws during composition.
- Scoped ports still expose only `get()` and `set(value)`. Type-surface checks
  prove there is no namespace argument and that a stateful tool without a
  namespace is not a valid contribution. Two-feature runtime tests still prove
  independent values and duplicate rejection.
- Only the resolved active view mounts. The inactive-view test still compares
  the full rendered `innerHTML` with strict byte-for-byte equality.
- No TypeScript suppression remains anywhere under `src/features/crm-clients`.
  Runtime ownership tests retain their hostile mutation attempts through
  explicit mutable test aliases and still prove source records stay unchanged.

No Cargo command, push, merge, deploy, or full gate was run.
