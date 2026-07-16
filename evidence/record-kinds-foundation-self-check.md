# WB-010 record-kinds foundation — self-check

Date: 2026-07-16

## Delivered contract

- Durable taxonomy: `household`, `person`, `organization`, `trust`.
- Relationship source of truth: a household document's `contactLinks` array.
  `linkContact` and `unlinkContact` make one household save, then reload; no
  reverse `householdIds` write exists.
- Public doorway: `@/features/crm-contacts` exports the typed models,
  validators, constructors, `useContactRecordStore`, async create/update/get/
  resolve/link/unlink/listRelated operations, directory/screen/print
  projections, references, and the read-only legacy adapter.
- CRM-clients exports `DirectoryContext`, `DirectoryContribution`, and
  `DirectoryRepository`. The live directory supplies the mixed contact
  projection and four-kind open/resolve repository callbacks. Non-household
  records are deliberately not sent to `HouseholdRecordSurface`.
- The contact-table path takes the mixed contact projection through the
  existing single `projectDirectoryResults` call; its legacy flag-off path is
  unchanged.
- Import fixtures cover CRM-clients directory, named record mounts, and public
  task/activity/files imports.
- Paved path: `src/features/crm-contacts/SKILL.md`.

## Proofs included in source

- `recordKinds.test.ts` creates all four kinds through the public store,
  recreates a fresh store, and resolves each kind with its original identity.
- The same test updates imported Organization/Trust documents and checks the
  durable kind plus unknown import/extension data remain intact.
- The relationship test reloads a household link, derives it again, and rejects
  a duplicate without creating a reverse contact write.
- The legacy-adapter test reads embedded Organization and Trust values without
  creating durable records or links.

## Checks run

| Check | Result |
| --- | --- |
| `git diff --check` | Passed. |
| Targeted TypeScript diagnostics using the available compiler | No diagnostics in the changed contacts/client paths after fixes. |
| `npm run typecheck` | Not runnable: this worktree has no `node_modules` (`tsc` unavailable). |
| `npm run boundaries:check` | Not runnable for the same reason (`typescript` package unavailable). |
| Rust/Cargo | Not run, by coordinator instruction. |

Native/Rust schema touched = **NO**. Migration = **none/unreserved**. No native
command manifest entry was added.
