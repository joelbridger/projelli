# WB-138 firm data-backup doorway result

**Base SHA:** `8118b12cca5f05892e1418c254818268795694e8`

**Final verified source SHA:** `c24283caf02309e64673ba0a1d04b37cead0d947`

**Verified-source status:** clean (`git status --short` returned no output)

**Shared receipt:** `src/features/data-portability/evidence/receipt.md`

The evidence-only receipt/report commit follows the final verified source SHA.
Its exact clean tip SHA is pasted in the worker handoff because a committed file
cannot contain its own Git ID.

## Result

PASS. Settings now mounts exactly one visible Data export panel through the
real Workspace registry doorway. Opening it does not load or copy firm data.
The user must click the one archive action, which invokes the existing public
migration export once and presents the returned file receipt.

The doorway does **not** claim a complete firm backup. It says that capability
is unavailable and needs review, while offering only the existing decrypted
Wealthbox migration archive.

## Exact export contract

- Public callable route: `createMigrationExport(workspaceRoot, 'archive')` in
  `src/platform/crm/migration.ts`.
- Returned artifact proof: file path, byte length, SHA-256 checksum, manifest
  ID, and migration fidelity-report ID.
- Archive contents proven by the existing writer: source type, source ID,
  target record ID, original imported payload, total/per-type record counts,
  and the fetched/imported/skipped/rejected fidelity matrix.
- Existing fail-closed native behavior: imported and archived counts must
  reconcile before a file is written.
- No Rust/native command, migration serializer, import flow, or alternate
  export store was added or changed.

## Precise UI wording boundary

The panel says the archive excludes other workspace data, documents, email,
and payloads from migration rows that were skipped or rejected. It also warns
that the JSON is decrypted. A result missing any inspectable receipt field is
shown as needs review, never as a successful backup.

## Checks at the verified source SHA

```text
$ npx vitest run src/features/data-portability/DataExportBackupSettings.test.tsx src/features/settings/registry/settingsModuleRegistry.test.ts tests/unit/architecture-boundaries.test.ts tests/unit/i18n/en-json-snapshot.test.ts
Test Files  4 passed (4)
Tests  25 passed (25)
```

```text
$ npm run typecheck
> tsc --noEmit
PASS

$ npm run typecheck:tests
> tsc -p tsconfig.test.json --noEmit
PASS

$ npm run boundaries:check
✅ No feature-boundary regression (599 current baseline finding(s)).

$ npx eslint <all touched TypeScript and TSX files>
PASS (no output)

$ npx prettier --check src/features/data-portability
All matched files use Prettier code style!

$ git diff --check
PASS (no output)
```

## Scope attestation

Changed only the granted new data-portability feature, one Settings registry
import/entry, its focused registry test, the one-line coordinator-granted
`settings->data-portability` architecture edge, and these receipts.

The whole-tree reference scan excluded only generated/vendor trees:
`.git/**`, `node_modules/**`, `dist/**`, `dist-*/**`, `target/**`, and
`coverage/**`. No references appeared outside the granted surfaces. A separate
protected-seam scan returned zero matches for native export invocation/writers,
selection authority, matter state, shell/routing, or CRM-home descriptors.

## Independent review verdict

PENDING — the coordinator is arranging the required different-model review.
No builder-supplied reviewer verdict is claimed.

WORKER-DONE: v1/data-export-backup ready for review
