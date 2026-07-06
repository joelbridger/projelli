# Worker brief — QA-92: pre-existing files invisible to Ask (#1 DEMO BLOCKER)

You are **cc-lantern-qa92**, working in worktree **~/lp-qa92** on branch **lp/qa92-preexisting-index** (off tip a4046edd). Rust-heavy TDD lane. You do NOT merge — the coordinator merges. Report progress as plain text.

## The bug (proven live on real Windows)
Ask can answer about files **created or imported during a live session**, but CANNOT find a client's files that were **already on disk when the workspace opened** (Word/PDF already sitting in the linked folder). This breaks the core "ask about your files" promise and blocks the demo.

## Root-cause investigation (Codex, complete — trust but verify)
Full log: `/tmp/claude-1000/-home-jameson-lantern-plus/d2987fde-186e-4ee1-b987-d3801e6a15cb/scratchpad/inv-preexisting-files.log` (1MB; read the tail ~20KB for the summary). Key findings:

The single-file watcher path was ALREADY fixed in commit **860b6f3c** ("verify rows before manifest fast-path" — touched `src-tauri/src/commands/rag/indexing.rs` + `store/maintain.rs`). Read that diff first so you extend it, not redo it. THREE holes remain:

1. **(b — main bug) Boot reconcile trusts the manifest without proving rows exist.** `src-tauri/src/commands/rag/reconcile.rs` — the walk sees all files (~line 347), but `FileDecision::Skip` (~line 424) just copies the manifest entry forward without checking LanceDB rows. A manifest entry that says "fresh" with zero actual vector rows = file silently unsearchable forever. Fix: before accepting Skip, verify rows exist for that path+scope (use/extend `store::path_has_expected_rows_for_scope` added in 860b6f3c); if not, push a WorkItem to re-index. Same guard for the PDF freshness path `rag_manifest_pdf_fresh` in `lifecycle.rs` (~line 337–370): manifest-fresh but 0 rows ⇒ return not-fresh.
2. **(c) Boot retag no-op leaves files unassigned.** Boot work items default to `unassigned` (`reconcile.rs` ~line 431); the frontend retags later (`src/platform/hooks/useMemoryWiring.ts` ~line 1080 → `retagMatterBatch`). If retag updates ZERO rows for a mapped folder, those paths must fall back to real indexing — otherwise they stay unassigned and client-scoped Ask never sees them.
3. **(d) Same-workspace reopen never arms the boot scan.** `src-tauri/src/commands/rag/indexing.rs` ~lines 33 and 92: the full/reconcile scan only arms when the workspace ROOT CHANGES. Reopening the same workspace (the normal daily case!) skips boot indexing entirely — the watcher becomes the only indexer, and it never fires for already-present files. Fix so a reopen still runs (at least) a reconcile pass.

## ⚠️ VERIFY FIRST (coordinator-8's explicit caveat — do this before writing any fix)
Write a failing test that proves the actual end-to-end symptom: **on a FRESH workspace open with files already on disk, do those files ever get indexed and become findable under the correct client scope?** It may turn out the initial full scan never happens at all in the failing scenario (hole d), not just the manifest-rows issue (hole b). Nail down WHICH holes reproduce, then fix all that do (and any that plausibly hit the demo path). Don't fix blind.

## Method: strict TDD (Rust)
- Red: failing `cargo test` per hole (reconcile-skip-with-missing-rows; pdf-fresh-with-zero-rows; retag-zero-rows-fallback; same-root-reopen-still-reconciles). Follow the test patterns already in `src-tauri/src/commands/rag/` from 860b6f3c.
- Green: minimal robust fix. NO shortcuts — this is core-app code (robustness rule).
- Keep the fix scoped to the RAG indexing/reconcile path. Do NOT rename `matter_id`/`Matter` (locked facade). Do NOT touch unrelated files.

## Build/test notes
- Rust: `cd ~/lp-qa92/src-tauri && cargo test` — sccache is installed; use the worktree-local default target dir (do NOT point at a shared CARGO_TARGET_DIR).
- If you touch TypeScript (hole c likely touches `useMemoryWiring.ts`): `npx tsc --noEmit` + scoped `npx vitest run <files>` in ~/lp-qa92.
- Full gate is the coordinator's job at merge; you run the scoped proof.

## Done criteria (HARD)
1. All new tests red-then-green shown with real command output.
2. `cargo test` (rag module at minimum) green; `npx tsc --noEmit` green if TS touched.
3. Committed AND pushed: `git push -u origin lp/qa92-preexisting-index` (pre-push may fail on OCR assets — they were copied in; if it still fails for unrelated reasons, use `git push --no-verify` and say so).
4. Pull/reconcile with current origin/lantern-plus tip before the sentinel.
5. THEN print exactly: `WORKER-DONE: lp/qa92-preexisting-index` followed by a 5-line plain-text summary: which holes reproduced, which you fixed, test evidence, anything you did NOT fix and why.
