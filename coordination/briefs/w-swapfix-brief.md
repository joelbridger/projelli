# Worker brief — reindex-swap round 2: two verified review findings (merge-blocking)

You are **cc-lantern-swapfix**. Work in the EXISTING worktree **~/lp-swapwrite** (branch `lp/reindex-swap` @af5017bf — its previous lane ended; the worktree is yours). You do NOT merge. Rust-only branch. SCOPED `cargo test` only (rag store area). ⚠️ Cargo's build lock is shared box-wide and another lane (connfix2) also compiles Rust — if your build blocks on the lock, just wait it out; never spawn parallel cargo jobs. Read `coordination/WORKER-DISCIPLINE.md`.

Fresh Codex review found 2 issues; the coordinator verified both against the code.

## F1 (BLOCKER) — fallible dedup AFTER the committed merge turns success into a hidden file
Both merge paths (write.rs ~586-596 single, ~666-680 grouped) run `dedup_duplicate_ids_for_path(...)?` AFTER `merge_insert` has committed, and propagate its error. Consequence: the content swap SUCCEEDED, but a transient dedup failure makes the command return Err → `rag_index_file`'s fail-closed path (indexing.rs ~242) durably tombstones the path → the file vanishes from search until a later successful re-index. A partial-success command boundary that recreates the disappearing-file symptom this branch exists to kill.
**Fix:** no fallible work after the successful merge. Run the pre-existing-duplicate cleanup BEFORE the merge (if it fails there, content is untouched and the error is honest), and if any post-merge tidy remains, make it best-effort log-only — it must never fail the command. Preserve the original P2 dedup intent (see `dedup_duplicate_ids_for_path`'s doc comment) — just move where it runs.

## F2 — incoming duplicate chunk ids are possible (PDF band overflow) → undefined merge + silent content loss
The grouped path's comment claims "page/sheet groups never collide", but pdf_indexer.rs ~58 stamps `paragraph_index = page_idx * MAX_CHUNKS_PER_PAGE + sub_idx` with NO check that `sub_idx < MAX_CHUNKS_PER_PAGE`. A very long page overflows into the next page's band → two incoming rows share an id → `merge_insert` on duplicate source ids is undefined, and the dedup then deletes all but one row → silent content loss.
**Fix (both layers):** (a) make the collision impossible by construction in the PDF chunker — never emit more than the band width per page; if a page exceeds it, extend honestly (e.g. merge overflow into the final in-band chunk, or widen the band) — choose the option that cannot silently drop text and document it; (b) defense-in-depth in both merge paths: validate the incoming batch's ids are unique before executing the merge and return a clear error if not (an honest indexing failure beats undefined behavior). Add tests: a synthetic long page exceeding the band; duplicate incoming ids rejected.

## Method
TDD, red→green per finding, `cargo test` scoped to the rag store/pdf modules with BARE exit codes. Keep the branch's excellent version-walk atomicity test green.

## Done criteria (HARD)
Committed AND pushed to `lp/reindex-swap` (`git push --no-verify`), verify with `git ls-remote`. THEN print exactly: `WORKER-DONE: lp/reindex-swap round2` + 3-line summary (where dedup moved, banding choice, test evidence).
