# Worker brief — connector-parity round 3: four verified re-review findings (2 blocking)

You are **cc-lantern-connfix3**. Work in the EXISTING worktree **~/lp-secondwave** (branch `lp/connector-parity` @1e54452b). You do NOT merge. SCOPED tests only; one cargo compile at a time on this box (wait out the shared build lock if hit). Read `coordination/WORKER-DISCIPLINE.md` + prior brief `w-connfix2-brief.md` for context. Core-app rule: robust over quick.

## F1 (BLOCKING) — a sync STARTING during disconnect resurrects everything
Round 2's wait loop only covers a sync already running. `onedrive_sync` (commands.rs ~732) can start right after the check AND it clears the cancel flag (~740); the UI leaves "Sync now" clickable during disconnect (OneDriveConnect.tsx ~522). A fresh sync after the purge recreates files/DB/RAG.
**Fix:** one shared backend gate: a `disconnecting` flag (AtomicBool or tokio permit) on `OneDriveState`; disconnect acquires it before cancel+wait and releases at the end; `onedrive_sync` + `onedrive_list_folders` reject immediately while it's held. UI: disable Sync-now/confirm while disconnecting. Regression test: disconnect racing a second sync start.

## F2 (BLOCKING) — reconnect can silently overwrite a kept-and-edited file
After a keep-files disconnect the tracking DB is gone; on reconnect the engine writes remote bytes straight over the target path (engine.rs ~313). User edits a kept file → reconnect → edits gone.
**Fix (robust, protects every case):** before materializing to a target path, if the file EXISTS on disk and the source_id is not already tracked to that exact path, do NOT overwrite — write a conflict copy (e.g. `name (OneDrive).ext`) or skip with a clear per-file report entry (pick the option most consistent with existing conflict handling in the codebase — search for prior conflict-copy patterns first). Test: disconnect-keep → edit file → reconnect → local edits survive.

## F3 (Medium) — opt-in delete trusts stored paths
`delete_materialized_files` (commands.rs ~362) does `ws.join(rel)` on raw DB strings. Enforce the workspace boundary per the repo's PathValidator principle: reject absolute paths and any `..` component; canonicalize where possible and require containment; unsafe path = failed delete (keep token+DB, dataRemains=true). Unit tests for each rejection.

## F4 (Low/Med) — UI conflates "data remains" with "disconnect incomplete"
UI sets its `dataRemains` for ANY incomplete disconnect (OneDriveConnect.tsx ~322), so it can say "Finish deleting local data" when only token removal failed. Split the state: `dataRemains` mirrors `result.dataRemains` only; a separate disconnect-incomplete state drives copy like "Finish disconnecting" when tokenDeleted=false. Keep plain-language copy.

## Done criteria (HARD)
All four red→green (tsc + scoped vitest + scoped cargo, bare exit codes), committed AND pushed (`git push --no-verify`), verify with `git ls-remote`. THEN print exactly: `WORKER-DONE: lp/connector-parity round3` + 4-line summary (one per finding).
