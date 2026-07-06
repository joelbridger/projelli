# Worker brief — QA-93 round 3: two verified review findings (merge-blocking)

You are **cc-lantern-qa93b**. Work in the EXISTING worktree **~/lp-qa93** (branch `lp/qa93-per-workspace` @514dde0d — its previous lane ended; the worktree is yours). You do NOT merge. SCOPED tests only. Read `coordination/WORKER-DISCIPLINE.md` and the prior brief `coordination/briefs/w-qa93-brief.md` for context.

Fresh Codex review found 2 High issues; the coordinator verified them and made one product ruling.

## F1 — migration carries RELATIVE folder paths, which readers then resolve against the CURRENT workspace
`migrateGlobalMattersForScope` (matterStore.ts ~582-590) keeps relative entries when a matter qualifies for a root. But a relative path is unproven: after migration, readers (e.g. `resolveMatterIdForWorkspacePath`) resolve it against the current root, so `/wsA/Clients/Legacy/file.docx` can be attributed to a client whose `Clients/Legacy` mapping was never proven to belong to /wsA. Misattributing a file to the wrong client is the worst failure class for this product — worse than a visibly-unmapped folder.
**Coordinator ruling:** at migration, keep ONLY absolute paths proven under the opened root: `folderPaths.filter((fp) => isAbsolutePath(fp) && isPathInFolder(fp, root))`. Dropped relative paths must not vanish silently — write one plain-language audit-log entry per matter listing the dropped mappings (the advisor can re-map; the audit trail explains why a folder stopped auto-filing). Update the mixed-path test to the new contract and add the reviewer's failure shape as a test.

## F2 — canceling a workspace switch can leave client stores on the NEW workspace while the user stays on the OLD one
`WorkspaceSelector.tsx` (~332) calls `setRootPath(...)` and THEN `onWorkspaceSelected(service)`; the lifecycle handler (useWorkspaceLifecycle.ts ~100-132) can still abort the switch (unsaved files, user cancels). Your branch reloads matter/client-map stores on root change, so an aborted switch strands the app: UI on workspace A, client stores on B. VERIFY the abort path exists first (trace handleWorkspaceSelected's cancel branches), then fix: the root must be committed in exactly one place, after the switch is irrevocable — have the selector await the handler's outcome (make it return success/failure) and only then perform root-committing + store reloads. Cover all three entry paths from your round-1 work (Open Existing, Recent, boot restore) with a cancel test.

## Method
TDD both, tsc + scoped vitest green (bare exit codes). LOCKED: never rename `matter_id`/`Matter`.

## Done criteria (HARD)
Committed AND pushed (`git push --no-verify`), verify with `git ls-remote`. THEN print exactly: `WORKER-DONE: lp/qa93-per-workspace round3` + 3-line summary.
