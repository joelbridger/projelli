# BUG-099 robust fix — LEAD HOLD (2026-06-23)

**Status: ✅ MERGED to `keepance-3.0` 2026-06-23 (merge `8554ee2a`).** Verified by the lead: Linux `cargo test --lib rag` 170 pass (incl. the forcing test); **real-Windows bench on the Legion = `cargo test --lib rag` 167 pass, 0 fail** (durable tombstone round-trips on disk, fail-closed sentinel works cross-process, no plaintext paths); full `npm run gate` green on the merged line. NOT deployed (signed build is Jameson's go). One out-of-scope follow-up: VMK-zeroization in the vaulted single-writer path (pre-existing, see end of this doc) — tracked separately.

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

## Update — 3rd robust pass DONE (2026-06-23, KEEPANCE-9-BUG099B)

The third pass closed all three blockers AND hardened the new tombstone through
**14 rounds of independent Codex (gpt-5.5) review** (each re-ran the test suite;
findings converged from real data-integrity holes → rare multi-failure durability
edges, all fixed + tested). Branch `fix/bug099-robust`, HEAD `bae302f1`.
**Still HELD pending lead review + real-Windows bench.**

Cross-process + restart + Windows durability the later rounds added on top of the
core fix: the tombstone is stored as opaque HMAC TOKENS in `.keepance/.unsafe_tokens`
(no plaintext paths, decorrelated from the failing vectors dir); written via atomic
temp+rename with a Windows-safe direct-write fallback that marks a durable
`.integrity_unknown` sentinel first (so a torn fallback write can't fail open);
an unreadable tombstone OR the sentinel makes retrieval/verify/MCP fail CLOSED;
a durable-write failure re-arms the full-index latch + emits an Error (not a false
"Memory ready") so the user can recover without a restart; and the clean-walk
rewrite holds the tombstone lock to serialize with the file-watcher.

What the 3rd pass delivered:
- **Fail-closed via a DURABLE per-path tombstone.** When a skipped file's
  stale-row cleanup DELETE fails (PurgeFailed), the file's at-rest HMAC PATH
  TOKEN (the `path` column value, NOT plaintext — VG-6e parity) is recorded in
  `RagState::unsafe_tokens` AND persisted to a durable `.keepance/.unsafe_tokens`
  file. Retrieval (`rag_retrieve`), citation verification (`rag_verify_citation`),
  and the external MCP search all exclude those tokens via `path NOT IN (...)` on
  the prefilter. A stale citation is now impossible after a cleanup failure —
  on every read path, and across an app restart (the set re-hydrates on workspace
  open). Surgical (only the one bad file is suppressed) and self-healing (cleared
  on any clean re-index — full walk OR file-watcher). Fail-closed on BOTH indexing
  paths (full walk + watcher).
- **Separate counters — no double-count.** A cleanup failure no longer counts the
  file twice in `skipped`; a distinct `cleanupFailed` counter tracks the extra
  failure so the banner's `indexed = total - skipped` stays correct. TS types +
  hook updated.
- **A REAL test** forces a genuine purge failure (read-only LanceDB dataset dir)
  and asserts the path is tombstoned, retrieval excludes its stale rows, and a
  clean re-index restores it. Codex independently re-ran the rag suite (167 pass)
  + typecheck (clean).
- **Durability hardening surfaced by review:** tombstone persists OUTSIDE the
  failing vectors dir (sibling `.keepance/`, so a locked dataset dir can't block
  it); atomic temp+rename write (no torn file on crash); fail-loud on a corrupt
  read; durable-persist failure refuses to stamp the index-version marker (forces
  a re-run); and a same-workspace remount MERGES the disk set into the live set
  so a live in-memory-only tombstone is never dropped.

Gates (Linux): `cargo test --lib rag` 168 pass; rag integration (mcp_binary 21,
rag_matter_scope 11+2 ignored, rag_deposition_contradictions 24, rag_delete_matter
4, mail_fixture_import 1) pass; `npm run typecheck` 0; full `npx vitest run` 3732
pass; `node scripts/eslint-gate.mjs` 0 new. INDEX_VERSION still 10; no f98aac6;
single-writer + happy path intact.

### Flagged for the lead (NOT fixed in this pass — out of scope)
- **VMK zeroization (pre-existing).** Codex flagged that the vaulted-workspace VMK
  is copied into a plain `Option<[u8; 32]>` (and into each spawned file task) that
  is not zeroized on drop. This copy PRE-DATES this branch (it lives in the
  `harden-rag-indexer` base) and is part of the single-writer design this ticket
  was told NOT to regress. It is a separate vault-feature security item, not a
  BUG-099 stale-citation issue. Recommend a dedicated ticket.

### Deferred (acceptable, not a blocker)
- Full process isolation of the extract/embed step. The single-writer fix (#2) addresses the immediate write-after-cleanup risk without it.
- Real-Windows bench verification remains the final follow-up before this ships.
