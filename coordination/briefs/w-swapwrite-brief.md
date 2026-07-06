# Worker brief — atomic re-index swap (BUILD-ONLY during demo freeze)

You are **cc-lantern-swapwrite**, worktree **~/lp-swapwrite**, branch **lp/reindex-swap** (off tip edde3e89). Correctness-sensitive Rust store lane. You do NOT merge. 🧊 **TIP FREEZE: merges post-demo — build, prove, push, stop.**

## The bug (from the demo step-4 adversarial review, scratchpad/codex-step4.log finding 4)
Re-indexing a file DELETES its old chunks, then ADDS the new ones (`src-tauri/src/commands/rag/store/write.rs:463,473,487`) with no single swap step. An Ask that retrieves between delete and add misses that file entirely — a real, silent, brief disappearance of a source mid-write. Verify the exact window first by reading the current code (this file has moved this week — re-locate by content; per-household replace tests exist in store tests as prior art).

## The fix (robust, no shortcuts — core data path)
Make re-index reads never observe the gap. Prefer, in order of fit with LanceDB's capabilities (investigate what the current lancedb crate version supports before choosing):
1. Version/generation column: write new rows tagged with a new generation, then flip a visibility marker and delete old-generation rows (readers filter to the current generation).
2. If LanceDB offers transactional/merge-insert semantics in our version, use them.
3. At minimum: add-then-delete (invert the order) with dedup on read for the brief overlap window — strictly better than delete-then-add.
Whatever you choose: document WHY in the code, keep the matter/privilege scoping semantics identical, and keep the QA-92 row-verification behavior working (reconcile counts rows — make sure your approach doesn't break its row-count proofs; read this week's changes in store/maintain.rs + reconcile.rs first).

## Method
Strict TDD: a test that interleaves a retrieval between the write phases and proves the file stays retrievable (prior art: `per_household_replace_completes_at_scale_no_orphans_or_dupes` in store tests). Scoped `cargo test` for the rag store area. NEVER the full suite. sccache is warm; use the worktree-local target dir.

## Done criteria (HARD)
Red→green evidence, scoped cargo green, committed AND pushed (`git push --no-verify -u origin lp/reindex-swap`). THEN print exactly: `WORKER-DONE: lp/reindex-swap` + 4-line summary (chosen approach + why, the interleaving test result, QA-92 compatibility note). Branch waits for the post-demo merge window.
