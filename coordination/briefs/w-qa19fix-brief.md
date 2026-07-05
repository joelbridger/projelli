# Build brief — QA-19 (P1): new/changed documents must become Ask-able without an app restart

**Lane:** cc-lantern-qa19fix · dir `~/lp-qa19fix` (own worktree, branch `lp/live-index`). **Model:** Sonnet 5 · high.
**Rules:** NO-SHORTCUTS (core app — robust fix, not a patch). TDD. Stay in your lane (indexing/RAG trigger paths; don't touch the Meetings surface, onboarding, or i18n files — other lanes own them right now). Self-converge via `codex-review --base origin/lantern-plus` to a clean round before handoff. If Rust is touched: `export CARGO_TARGET_DIR=$HOME/.cargo-target-lp-qa19fix` (symlink a seed from an existing warm cache on /mnt/devcache if helpful), ONE cargo at a time box-wide, wrap every cargo test in `timeout 1200`. No interactive menus — `COORDINATOR:` plain text for blockers.

## The bug (persona-B, real repro on Windows bench — BUG-DB QA-19 + coordination/qa-campaign/evidence/qa2-20260704/)
Create a Word doc in the app and type content into it — or drop files into a client's linked folder — then Ask about it: "Nothing found in your files." The content is real, saved, and correctly client-scoped. Only a full app restart triggers reindexing (restart logs show the reindex pick the files up). The core promised loop — jot a note, ask about it — is broken without a restart.

## What to build
Find where the RAG index ingest is triggered (restart-time scan) and make indexing LIVE: newly created/saved/imported documents get indexed (a) on autosave/write-through via WorkspaceService, and/or (b) on a filesystem watch of linked folders for external drops, and/or (c) at minimum on Ask-time (a cheap staleness check before answering — if dirty docs exist for the scoped client, index them first with honest UI feedback "Indexing 2 new documents…"). Choose the robust combination and state why — the bar: BOTH repro paths (in-app created doc; externally dropped file) become Ask-able within seconds, no restart, correctly client-scoped, no egress. Mind battery/perf (don't reindex the world on every keystroke — debounce; index deltas only).

## Gate + handoff
Red-first tests for both repro paths at the unit/integration level. `npx tsc --noEmit` clean · full `npx vitest run` green · eslint-gate clean · Rust-touched ⇒ `cargo test` green (timeout-wrapped, warm target). Dev server on a UNIQUE port if you drive the browser build. Handoff: HEAD SHA, gate counts, approach + trade-offs, self-review rounds, Rust-touched yes/no. Push your branch (NOT self-merged), then exactly: `WORKER-DONE: lp/live-index`
