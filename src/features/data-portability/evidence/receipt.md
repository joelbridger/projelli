# Firm migration archive doorway receipt (WB-138)

**Base SHA:** `8118b12cca5f05892e1418c254818268795694e8`

**Final verified source SHA:** `c24283caf02309e64673ba0a1d04b37cead0d947`

This receipt is an evidence-only follow-up to the verified source commit. Its
own final Git ID is self-referential, so the exact clean evidence-tip SHA is
pasted in the worker handoff.

## Export-contract preflight

PASS before edits:

1. `src/platform/crm/migration.ts` publicly exports
   `createMigrationExport(workspaceRoot, kind)`. It sets the selected workspace
   and calls the existing native `crm_migration_export` route.
2. The route returns a real receipt containing `filePath`, `byteLength`,
   `sha256`, `manifestId`, and `reconciliationReportId` after the file writer
   succeeds.
3. The existing archive writer creates a decrypted JSON file containing:
   - `sourceType`, `sourceId`, `targetRecordId`, and the original imported
     `payload` for each archived migration record;
   - a manifest with total and per-source-type record counts; and
   - the migration fidelity matrix with fetched, imported, skipped, and
     rejected counts.
4. The existing writer reconciles imported counts against archived counts and
   refuses to create the file when they differ. This lane needed no native,
   Rust, migration-serialization, or import-flow change.

The at-fire slate safety grep against the three named attachment files returned
`grep_exit=1` (zero protected-seam matches).

## Truth-in-UI decision

The Settings panel prominently says **“Complete firm backup unavailable —
needs review”** and **“This is not a complete firm backup.”** The only enabled
action is **“Create Wealthbox migration archive.”**

The included-content wording mirrors the contract above. The panel also says
the archive does not contain other workspace data, documents, email, or the
payloads of skipped/rejected migration rows, and warns that the JSON file is
decrypted.

The UI refuses to show success unless the returned value proves all receipt
fields, an archive export status, a positive byte count, and a 64-character
SHA-256 checksum. A partial response becomes a needs-review error.

## Behavior proof

The focused tests use the real registered Settings descriptor and prove:

- exactly one Workspace panel is registered;
- opening the panel makes zero export calls;
- clicking the explicit action calls the public migration export once with
  `archive`;
- the file path, byte count, checksum, manifest ID, and fidelity-report ID are
  shown;
- the existing export error is shown without a success artifact;
- an incomplete response fails closed; and
- no workspace means a disabled action and zero calls.

## Final-source verification

```text
$ npx vitest run src/features/data-portability/DataExportBackupSettings.test.tsx src/features/settings/registry/settingsModuleRegistry.test.ts tests/unit/architecture-boundaries.test.ts tests/unit/i18n/en-json-snapshot.test.ts

Test Files  4 passed (4)
Tests  25 passed (25)
```

```text
$ npm run typecheck
> tsc --noEmit
PASS (no output)

$ npm run typecheck:tests
> tsc -p tsconfig.test.json --noEmit
PASS (no output)
```

```text
$ npm run boundaries:check
✅ No feature-boundary regression (599 current baseline finding(s)).
```

```text
$ npx eslint <all touched TypeScript and TSX files>
PASS (no output)

$ npx prettier --check src/features/data-portability
All matched files use Prettier code style!

$ git diff --check
PASS (no output)
```

## Scope scan

Whole-tree reference scan scope: `.` including hidden files; exclusions were
`.git/**`, `node_modules/**`, `dist/**`, `dist-*/**`, `target/**`, and
`coverage/**`. Every data-portability reference was confined to the new
feature, its two Settings registry lines/focused tests, and the one granted
architecture edge.

The protected-seam scan covered the new feature, both touched registry files,
and the architecture test. It searched for direct native invocation/export
writers, client-context, matter-store, shell/router, and CRM-home descriptor
seams. Result: `protected_seam_scan=0 matches`.

`tests/unit/architecture-boundaries.test.ts` differs by exactly this one
coordinator-granted line:

```text
'settings->data-portability', // Settings mounts the migration-scoped data export through Data Portability's public descriptor doorway.
```

## Independent review

Coordinator-arranged different-model review is pending. The builder did not
self-source or impersonate that verdict.
