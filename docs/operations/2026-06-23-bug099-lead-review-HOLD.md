# BUG-099 robust fix — LEAD HOLD (2026-06-23)

**Status: NOT MERGED. Held on branch `fix/bug099-robust` (based on `harden-rag-indexer`).**

During the 2026-06-23 parallel build, KEEPANCE 4 produced a robust pass at BUG-099 (the RAG indexer freezing when one file gets stuck). KEEPANCE 4's own report: `docs/operations/2026-06-23-bug099-robust-fix-report.md` (on the branch). An **independent lead Codex review (read-only, gpt-5.5)** then re-checked it against the original DO-NOT-SHIP findings.

## Verdict: DO-NOT-SHIP as final (hold).

**Why this is the right call:** this is core-engine, data-integrity code (stale legal citations), so the "no shortcuts — build it right and robust" rule governs. The fix is much better but does not yet fully meet the safety claim "no stale citation can be served." BUG-099 is also **not urgent** — the shipped build does not crash today; the runaway only appeared under a previously-reverted forced rebuild.

### Confirmed GOOD (independently verified)
- The new blocking-work test is genuinely blocking (`std::thread::sleep`, not `tokio::time::sleep`) — `src-tauri/src/commands/rag/mod.rs:2337`.
- Does NOT re-introduce reverted `f98aac6`; `INDEX_VERSION` stays 10 (`store.rs:245`).
- Stale-row delete targets the correct tokenized path key (`mod.rs:344` → `store.rs:798`).

### The 3 blockers to fix before merge (the next robust pass)
1. **Cleanup-delete failure is swallowed as a successful skip.** If the stale-row delete fails, it logs "a stale citation may remain" but still returns `true` and emits `Done` (`mod.rs:354`, `:1000`, `:1036`). For a citation system that is still a data-integrity hole. Fix: surface the error / mark the index unsafe for that file; do not count a failed cleanup as a clean skip.
2. **A timed-out task can still write after the parent's cleanup** (abort is not a hard kill — `mod.rs:292`, `:297`). Best fix (per the review): make the timed child do extract/embed ONLY, and make the parent the single DB writer. This is the "single-writer" design — smaller than full process isolation, which can stay deferred.
3. **Skip counts never reach the UI.** The Rust event now carries `skipped/failed/timed_out/skipped_paths` (`mod.rs:160`), but the TS path drops them (`tauri-commands.ts:175`, `useRagStatus.ts:54`, `RagProgressBanner.tsx:115`), so the banner still says a plain "Memory ready." Either surface them in the banner or stop claiming "no silent Done." NOTE: this step crosses into the frontend, which was outside KEEPANCE 4's Rust-only lane — the next pass should include it.

## Update — 2nd robust pass reviewed (2026-06-23, still HELD)

A robust pass closed the single-writer + surfacing work; an independent Codex final review = **STILL DO-NOT-SHIP**, but much closer:
- ✅ **Single-writer: PASS** — the timed child does extract/embed ONLY (no DB handle); the parent walk is the sole writer; a timed-out child returns no result to write. The write-after-cleanup race is genuinely closed (`mod.rs` `run_file_extract_task` / `extract_embed_one_file` / `write_extracted_file`).
- ✅ INDEX_VERSION still 10; no f98aac6; happy path intact.
- ❌ **Cleanup failure is surfaced but NOT fail-closed (the remaining data-integrity hole):** when the stale-row delete FAILS (`PurgeFailed`), the file is counted as failed but **retrieval still serves its stale rows** — there is no tombstone/unsafe-path exclusion on the query path (`store.rs` retrieval). A changed+hung file whose cleanup failed can still be cited as current. Fix: **fail closed** — add a durable per-path tombstone that retrieval ALWAYS excludes (surgical: only that file's rows are suppressed; cleared when the path later re-indexes cleanly). Marking the whole index unsafe is the heavier fallback.
- ❌ **Double-count:** `PurgeFailed` counts the file twice (failed + skipped) → UI undercounts indexed. Use separate counters (unique skipped vs cleanup-failed/unsafe).
- ❌ **Test gap:** `purge_failure_is_not_swallowed_as_clean_skip` doesn't actually FORCE a purge failure (structural fallback). Add a test that truly forces it and asserts retrieval excludes the stale rows.

A third focused pass is closing these three on `fix/bug099-robust`.

### Deferred (acceptable, not a blocker)
- Full process isolation of the extract/embed step. The single-writer fix (#2) addresses the immediate write-after-cleanup risk without it.
- Real-Windows bench verification remains the final follow-up before this ships.
