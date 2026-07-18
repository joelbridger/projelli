# Task deletion seam result

- Registered base: `04b2e704ddc5cfb8154b0d60c6e5817d69d6b2fa`
- Actual launcher base: `3f07d77b80933518323fa21427091979a2b39281`
- Base relationship: the registered base is an ancestor of the launcher base
- Checked code tip: `bd409a9acf7f033db3080eeb1b46911900cf2018`
- Final commits after the code tip: evidence only
- Pushed/merged: no/no
- Rust/native production work: **NO**; one task-specific native test was added

## Result

PASS for the granted seam. The public `TaskRecordStore` now has one required
`remove(id)` doorway. It resolves the task from the current canonical live
snapshot, uses that record's stored `matterId`, and calls the already-landed
`softDeleteCrmRecord` doorway. The shared native trash service remains the
mutation authority, retains the full record for 30 days, writes the existing
trash audit lifecycle, blocks generic resurrection, and keeps permanent purge
behind its native deny-by-default firm-admin guard.

The task store reloads after successful removal. It refuses a missing task, a
task without a valid persisted matter scope, a missing workspace, an errored
live-record load, disabled trash, and non-desktop use through the existing
store/trash guards. No screen, task row, row action, shell, route, migration, or
second delete path was added.

## Round-trip proof

`taskRemoval.live.test.tsx` drives the public production task store and trash
client across the real renderer command contracts:

1. create through `crm_live_upsert`;
2. reopen through a fresh `crm_live_list` reader;
3. remove through `TaskRecordStore.remove` and `crm_trash_soft_delete`;
4. prove a fresh task reader cannot see the record;
5. list the retained task through `crm_trash_list`;
6. restore it through `crm_trash_restore`; and
7. prove a fresh task reader sees the original task again.

`commands.rs` adds the native SQLCipher-store version of the same proof. It
upserts a real task, soft-deletes it, closes and reopens the encrypted store,
proves generic upsert cannot resurrect the tombstone, restores it, closes and
reopens again, and verifies the task is live and absent from trash.

## Exact checks on the code tip

```text
$ npx vitest run <8 focused task/trash files>
Test Files  8 passed (8)
Tests       37 passed (37)
exit=0

$ npm run typecheck
tsc --noEmit
exit=0

$ npm run typecheck:tests
tsc -p tsconfig.test.json --noEmit
exit=0

$ npm run boundaries:check
No feature-boundary regression (599 current baseline finding(s)).
exit=0

$ npx vitest run tests/unit/architecture-boundaries.test.ts
Test Files  1 passed (1)
Tests       1 passed (1)
exit=0

$ npx eslint <11 changed TypeScript files>
no output
exit=0

$ rustfmt --edition 2021 --check src-tauri/src/commands/crm/features/trash/commands.rs
no output
exit=0

$ git diff --check 3f07d77b80933518323fa21427091979a2b39281..HEAD
no output
exit=0
```

The initial four-file Vitest run did not load any tests because this worktree
had a local cache directory instead of the repository's provisioned
`node_modules` link; `pdfjs-dist` could not resolve. Reconnecting the worktree
to the existing dependency tree fixed the environment. The corrected focused
run passed 11/11, and the expanded final run passed 37/37.

## Native-test attempt record

The task-specific SQLCipher test is **INCONCLUSIVE in this lane**, not claimed
green. The two permitted native attempts both stopped in the existing Tauri
build script before Rust compilation or test execution:

1. missing ignored package resource
   `binaries/piper-x86_64-unknown-linux-gnu`;
2. after staging the already-provisioned Piper helper, missing ignored package
   resource `binaries/llama-server-x86_64-unknown-linux-gnu`.

No third attempt was made. The native test is formatted and ready for the
coordinator's already-warmed merge gate, where the full package resources are
staged. Whole-workspace `cargo fmt --check` is also inherited-red across many
untouched Rust files; the exact changed Rust file passes `rustfmt --check`.

## No-stray-path guard and whole-tree scan

The committed guard scans every production TypeScript file and every native
Rust source file. The final scan reports:

```text
task_direct_native_routes=0
task_soft_delete_owners=src/features/crm-tasks/taskRecordStore.ts
renderer_native_soft_delete=src/features/crm-trash/trashClient.ts
hard_delete_sql_owners=src-tauri/src/commands/crm/features/trash/commands.rs
```

This means task code has no direct native command call, the task store is its
only soft-delete owner, the shared trash client is the sole renderer bridge to
native soft deletion, and all hard-delete SQL stays inside the existing trash
authority. The guard will fail if a later task lane adds a bypass.

## Scope attestation

The code-tip diff contains exactly:

```text
src-tauri/src/commands/crm/features/trash/commands.rs
src/features/crm-tasks/extensions/attachments/TaskAttachmentsField.test.tsx
src/features/crm-tasks/extensions/attachments/persistence.test.ts
src/features/crm-tasks/extensions/create/TaskCreateTemplate.test.tsx
src/features/crm-tasks/extensions/create/createTask.test.ts
src/features/crm-tasks/index.ts
src/features/crm-tasks/taskRecordStore.test.tsx
src/features/crm-tasks/taskRecordStore.ts
src/features/crm-tasks/taskRemoval.live.test.tsx
src/features/crm-tasks/taskRemovalSeam.guard.test.ts
src/features/crm-trash/index.ts
src/features/crm-trash/trashClient.test.ts
```

The four one-line test-double changes keep existing tests compile-complete now
that `remove` is a required public contract. No production task create/update
behavior changed. No flag, locale, registry, baseline, manifest, command
registration, timeout, snapshot, suppression, skip, or weakened assertion
changed. Independent review remains coordinator-arranged.

## Evidence binding

This receipt binds to code tip `bd409a9acf7f033db3080eeb1b46911900cf2018`.
After that tip, the only intended path is:

```text
prep/wave2-results/task-deletion-seam.md
```

The launcher alone owns the completion marker.
