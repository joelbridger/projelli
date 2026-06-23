# BUG-099 hardening — independent Codex review (2026-06-22)

**Verdict: DO-NOT-SHIP (do not merge `harden-rag-indexer` as-is).**
**Reviewer:** Codex (gpt-5.5, high effort), read-only, reviewing `git diff keepance-3.0...HEAD` in worktree `.worktrees/harden-rag-indexer` @ `32e451e8`.

## What the change is
Rust RAG-indexer hardening so one pathological file can't freeze the whole workspace index walk: each file's extract+embed now runs behind a 5-minute guard; failed/timed-out files are skipped (with counters + warning logs) and the walk continues and still stamps the completion marker. Touches only `CHANGELOG.md` and `src-tauri/src/commands/rag/mod.rs`.

## What's good (confirmed by the review)
- Normal successful indexing still flows through `index_one_file`, so ordinary chunking / source metadata / citation paths are essentially untouched.
- It does **NOT** re-introduce the reverted commit `f98aac6` (that bumped `INDEX_VERSION` 10→11 and added path canonicalization + drop/re-index across `store.rs`/`pdf_indexer.rs`/`watcher.rs`). This diff keeps `INDEX_VERSION = 10` and touches neither file. Good.

## Why not ship yet (the real findings)
1. **High — the timeout doesn't reliably STOP the bad work.** Rust task `abort()` is not a hard kill; it only takes effect at an `await` point. A file stuck in synchronous parsing (docx/rtf/xlsx/pptx extraction) or in the `spawn_blocking` embedder can keep consuming a runtime thread and memory after the walk moves on. So the visible "20/21" stall is unblocked, but the memory-runaway safety goal is not fully proven.
2. **High — a timed-out file can leave STALE CITATIONS.** The timeout path only bumps counters; it does not delete the file's old chunks. If a file changed and then hung, Keepance can still answer from the old indexed version. For a product whose promise is trustworthy citations, a stale citation is worse than a missing one.
3. **Medium — skips aren't surfaced to the user.** The skip/fail counts go to logs only; the progress event still reports `Done` with no skipped count, so a user sees "done" while files were silently skipped.
4. **Medium — the test only covers the easy case.** The new test uses a cancellable `tokio::time::sleep` for the "slow" file; it doesn't cover a truly blocking parser, a blocking embed, a LanceDB write stall, stale-row cleanup, or UI-visible skip reporting.

## Recommended fixes before merge
1. On `TimedOut`/unrecoverable `Failed`, delete the file's stale rows (or tombstone it) so retrieval can't cite old content as current.
2. Surface skip counts (and ideally paths) through the progress event / command result, not just logs.
3. Add a test for stale-citation cleanup on timeout/failure.
4. Add a test/harness for genuinely blocking work (not async sleep). If a true hard-kill is required, the dangerous extract/embed step likely needs process isolation, because Rust cannot safely kill an arbitrary stuck thread.

## Disposition
Per the Keepance "no shortcuts on the core app — build it right and robust" rule, this stays **unmerged**. The robust fix (especially finding #1, which may need a process-isolation design decision) is its own deliberate, bench-verified effort — not a rushed parallel patch. The shipped/normal build does not crash today (the runaway only appeared under the reverted forced rebuild), so this is not urgent. Full review transcript was captured in the session scratch output for this run.
