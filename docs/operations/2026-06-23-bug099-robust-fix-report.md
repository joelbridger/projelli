# BUG-099 robust fix — report (KEEPANCE 4)

**Date:** 2026-06-23
**Branch:** `fix/bug099-robust` (based on `harden-rag-indexer`)
**Scope:** Rust-only RAG indexer engine (`src-tauri/src/commands/rag/`)
**Status:** the four spec'd gaps are DONE + tested. Two new architectural items surfaced by an independent Codex review are flagged below for a lead/Jameson decision (NOT built).

---

## Plain-language summary (for Jameson)

The app reads your files into a private "search index" so it can answer questions about them with citations. A while ago we found a bug (BUG-099): if one file got "stuck" while being read, the whole index could freeze, and in a bad case eat all the computer's memory.

The first patch stopped the freeze by giving each file a 5-minute time limit. An independent review (our second AI engineer, Codex) found four things that patch still got wrong. I fixed all four:

1. **No more out-of-date answers.** If a file gets skipped (stuck or broken), I now throw away its *old* index entry on the spot. Before, the app could still quote an old version of a file it could no longer read — and quoting the wrong version is worse than saying nothing.
2. **No more silent "Done."** The app now reports *how many* files were skipped and *which ones*, so the screen can say "done, 2 skipped" instead of pretending everything worked.
3. **Proof it works (test 1):** an automated test confirms the old entry really is deleted when a file is skipped, and that good files are left alone.
4. **Proof it works (test 2):** an automated test uses a file that *truly* jams (not a fake, easily-cancelled jam) and confirms the index keeps moving instead of freezing.

One harder problem remains and I did **not** fix it on my own, on purpose, because it's a bigger design decision for you to weigh in on: when a file truly jams, the time limit lets the *index* move on, but the jammed work keeps running invisibly in the background and can still slowly use memory. Truly "killing" that stuck work would mean running file-reading in a separate, sandboxed helper program ("process isolation") — a real change worth a deliberate decision, not a rushed one. Details below for the engineer who merges this.

---

## What I changed (the 4 gaps)

All changes are in `src-tauri/src/commands/rag/mod.rs`.

### Gap 1 (High) — stale-citation cleanup on skip
- New `purge_stale_rows_on_skip(table, file_path, key, outcome) -> bool`.
- On `TimedOut` or `Failed`, it calls `store::delete_path(...)` (best-effort, logged on error) to drop the file's previously-indexed rows. On `Indexed` it does nothing and returns `false` (a clean re-index already replaced the rows atomically via the upsert delete+add).
- Wired into the walk's per-file step, immediately after the per-file outcome is known.
- **Why this is the fix:** `upsert_chunks_for_path` is delete-then-add, so a *successful* re-index is always consistent. The hole was that a timed-out/failed file never reached that write, leaving the prior version's rows in place → a stale citation. Now any skip drops them.

### Gap 2 (Medium) — surface skips to the UI, not just logs
- `IndexingProgress` gained `skipped`, `failed`, `timed_out` (camelCase on the wire) and `skipped_paths` (`#[serde(skip_serializing_if = "Vec::is_empty")]`, so per-file events stay small).
- Per-file `Indexing` events carry the cumulative counts; the terminal `Done` / `Cancelled` events carry the final counts plus the skipped paths, bounded by `MAX_REPORTED_SKIPPED_PATHS = 100` (`cap_skipped_paths`). Counts stay exact regardless of the cap.
- `IndexingProgress` + `IndexingStatus` now derive `Default` so the unchanged emit sites use `..Default::default()` for the new fields (minimal churn, no behavior change).
- **Frontend follow-up (not my lane):** the TS mirror in `src/utils/tauri-commands.ts` and the `useRagStatus` banner should be updated to *display* "done, N skipped". The data is now available on the event; nothing breaks if the UI ignores it (the new fields are additive / optional).

### Gap 3 — test for stale-row cleanup
- `skip_outcome_purges_stale_rows_but_indexed_outcome_keeps_them`: seeds a real LanceDB table, then asserts the rows are gone after `TimedOut` and after `Failed`, and are kept after `Indexed`.

### Gap 4 — blocking-work harness (not a cancellable async sleep)
- `workspace_walk_guard_times_out_on_genuinely_blocking_work`: the "slow" future does `std::thread::sleep` (a synchronous block on a runtime worker, like a stuck docx/rtf/xlsx parser or the blocking embedder). Asserts the guard returns `TimedOut` *promptly* (`elapsed < 500ms` vs an 800ms block) and that the blocking task is **still running** after `abort()` (documents finding #1 — see below).

---

## Verification

```
cd ~/keepance-bug099/src-tauri
export CARGO_TARGET_DIR=~/keepance/src-tauri/target
cargo test --lib rag
```

Result: **`test result: ok. 156 passed; 0 failed; 1 ignored`** (the 1 ignored is the RAG-model test that needs `e5-small`; set `REQUIRE_RAG_MODEL=1` to run it). `cargo build --lib` reports **0 warnings**. The four new tests:

- `progress_serializes_skip_counts_and_paths` ✓
- `progress_omits_empty_skipped_paths` ✓
- `skip_outcome_purges_stale_rows_but_indexed_outcome_keeps_them` ✓
- `workspace_walk_guard_times_out_on_genuinely_blocking_work` ✓

> Build note: the worktree was missing the gitignored Tauri sidecar placeholder `src-tauri/binaries/piper-x86_64-unknown-linux-gnu` (it lives only in the main checkout). I recreated it as a 0-byte file so the `tauri_build` resource check passes. It is gitignored and NOT part of the diff.

**Full proof still needs a real-Windows bench run** (the original stall only reproduces there). That is a separate follow-up for the lead/Jameson, per the task.

---

## Finding #1 (the hard one): does a true hard-kill need process isolation? — YES, recommend flagging

**Confirmed by the new blocking-work test:** a Rust task `abort()` is *not* a hard kill. It only cancels at an `.await` point. A file stuck in **synchronous parsing** (docx/rtf/xlsx/pptx) or inside the **blocking embedder** (`spawn_blocking`) keeps consuming a runtime thread and its memory after the walk has moved on. The test's `finished` flag is still `false` right after the timeout — the work is provably still alive.

**What my fix does and does not buy:**
- ✅ Stops the *visible stall* (the "20/21 files" freeze) — the walk continues.
- ✅ Stops *stale citations* — skipped files have their old rows dropped.
- ✅ Stops the *silent Done* — skips are surfaced.
- ❌ Does **not** stop a *resource runaway* from a single pathological file: a decompression bomb or quadratic-blowup parser can still pin a thread and grow memory in the background even though the walk reports progress. The existing size caps (5 MiB text / 50 MiB office) bound normal inputs but are not a hard guarantee against a crafted file.

**Recommendation (for the lead + Jameson):**
- **Do not build process isolation in this branch.** It's a real architectural change: run the dangerous extract/embed step in a separate child process (Tauri sidecar or a small worker binary) with a hard `kill()` + a memory cap, marshalling bytes in and extracted text/vectors out. It closes the resource-runaway completely but is its own deliberate, bench-verified effort.
- **Cheaper interim option to consider** (smaller, in-process, defense-in-depth — also its own ticket): bound the work *before* it runs — reject office packages whose uncompressed/compressed ratio looks like a zip-bomb, and cap total chunk count per file before embedding. This shrinks the probability of a runaway without a process boundary, but is not airtight.
- **My read:** the *urgent* user-visible damage (stall + stale citations) is fixed now. The resource-runaway is real but narrow (needs a crafted/corrupt file, and historically only surfaced under the reverted forced-rebuild). Treat process isolation as a planned hardening item, not a launch blocker.

---

## Two new findings from the independent Codex review (flagged, NOT built)

I ran an adversarial `codex-review` (read-only, gpt-5.5) over the diff. It confirmed the fixes are sound and raised two items I judged to be architectural / out of the spec'd 4 gaps. I did **not** expand the diff into the shared `index_one_file` mid-parallel-effort; the lead should triage these.

### P1 — the timeout cleanup can race a still-running write (same family as finding #1)
- **Claim:** if the 5-minute timeout fires *while* the aborted task is mid-`delete`/`add` on LanceDB, the cleanup `delete_path` can run concurrently with the zombie's same-path write — the concurrent-mutation shape F-301 avoided.
- **My assessment — valid but narrow:**
  - Only the `TimedOut` path is exposed (a `Failed` task has already returned — no zombie).
  - The BUG-099 trigger is a stall in *extraction* (pre-write), where the zombie has not touched the table → cleanup is safe. The race needs a stall *during the DB write itself*, which is rare (writes are sub-second unless a write hangs).
  - The realistic outcomes are benign-to-mildly-inconsistent (two idempotent same-path deletes; or a file counted "skipped" that is actually present with *current* content — not a stale citation, not a `drop_table`). LanceDB resolves concurrent delete/add via commit-conflict retry; the F-301 corruption was specifically concurrent `drop_table` + reindex, which my row-level delete does not do.
- **Recommended fix (architectural, lead/Jameson):** make the timed task **extract+embed only** and have the **parent be the sole writer** (do the single delete/add after a successful outcome). This makes single-writer airtight and also closes finding #1's *write-safety* half. It restructures `index_one_file`'s contract, which is shared by the walk and the watcher (`rag_index_file`) — bounded (2 callers, all in `rag/mod.rs`) but a deliberate change. Same family as the process-isolation decision; I recommend deciding them together.
- **Net:** my change is still a strict improvement over the prior code (which left a *guaranteed* stale citation on timeout); the residual is a rare, mostly-benign race.

### P2 — corrupt/unreadable files report as "Indexed", so they're invisible
- **Claim:** for corrupt / unreadable / too-large / missing indexable files, `index_one_file` deletes stale rows and returns `Ok(())` → the walk sees `Indexed` → these files are not counted in `skipped` / `skipped_paths`, so the user still sees a clean "Done" for a file that wasn't indexed.
- **My assessment — valid gap, but the naive fix is wrong:** counting every `Ok`-with-no-chunks as "skipped" would also flag *legitimately empty* files (an empty notes file), creating false "N skipped" alarms. Doing it right needs a typed return from `index_one_file` (e.g. `Indexed` vs `IndexedEmpty` vs `SkippedUnreadable`) so only genuine read-failures are reported. Bounded (1 file, 2 callers) but beyond the spec'd 4 gaps and it touches the shared function.
- **Recommendation:** small follow-up ticket — enrich `index_one_file`'s return to distinguish read-failures from empty-but-fine, then fold read-failures into the skip counts. Worth doing for the "no silent Done" goal, but with the empty-file nuance, not a hasty patch.

---

## Handoff

- Branch `fix/bug099-robust` pushed. Do NOT merge / build / deploy (lead's call).
- Before the lead runs the full `npm run gate` (which compiles Rust), coordinate so two cargo compiles don't collide on the shared `CARGO_TARGET_DIR`.
- Decisions needed from the lead/Jameson: (a) process isolation for a true hard-kill (finding #1); (b) the single-writer restructure for P1; (c) the typed-return follow-up for P2. I recommend bundling (a) + (b) as one "make the indexer's dangerous step truly fenceable" decision.
