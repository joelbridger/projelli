# LANTERN-PLUS — What this folder is (READ THIS FIRST)

**Created 2026-07-02 by Jameson's direction.** This is a **full, git-linked fork of Keepance**
(internally now called **Lantern**), branched from the true `keepance-3.0` tip
(`000060cf`, fetched fresh from GitHub) onto the branch **`lantern-plus`**.

## Why it exists

Two efforts run in parallel and must not collide:

1. **`~/keepance` (main folder)** — the standalone Lantern being hardened, demoed, and
   released. Another coordinator instance with subagents actively works there.
   **Never edit files in `~/keepance` from a Lantern-Plus session.**
2. **`~/lantern-plus` (this folder)** — builds the **Jump feature-parity program**:
   meeting capture, calendar → auto prep briefs, CRM write-back, and related features,
   per the feasibility assessment in [`feasibility/ASSESSMENT.md`](feasibility/ASSESSMENT.md).

## Ground rules for agents working here

- **Branch:** all work happens on `lantern-plus` (tracking `origin/keepance-3.0`) or
  feature branches off it (`lp/<feature>`), merged back into `lantern-plus`. Push to
  GitHub (`keepance/keepance`) freely; **never push to `keepance-3.0` itself** — that
  branch belongs to the main-line effort.
- **Stay mergeable:** prefer NEW modules/folders (`src/features/meetings/`,
  `src-tauri/src/commands/calendar/`, etc.) over edits to shared files. When a shared
  file must change, keep the diff minimal. Periodically
  `git fetch origin && git merge origin/keepance-3.0` into `lantern-plus` so drift
  stays small. Serialize merges; resolve conflicts in favor of main-line for
  everything outside this program's scope.
- **The plans are the spec:** [`docs/plans/lantern-plus/`](docs/plans/lantern-plus/)
  contains the master plan and per-wave implementation plans, written for Opus 4.8
  agents. Follow them; don't re-derive strategy.
- **All Keepance rules still apply** (CLAUDE.md in this repo): no shortcuts on core,
  gate before merge (`npm run gate`), never rename `matter_id`, no cloud paths for
  user content, only one cargo compile at a time (shared CARGO_TARGET_DIR).
- **Do not deploy or release from this folder.** Demo/release happens from the
  main-line effort. Lantern-Plus features reach users only by merging back after
  Jameson's go.

## Contents beyond the code fork

- [`feasibility/`](feasibility/) — the complete Jump feasibility assessment + research
  (moved here from `~/keepance-jump-feasibility`, now the canonical copy).
  Published report: https://jameworld.com/claudereports/r/2026-07-02-keepance-vs-jump-feature-parity-feasibility-assessment.html
- [`docs/plans/lantern-plus/`](docs/plans/lantern-plus/) — the implementation plans + the binding UI-INTEGRATION-SPEC + the NEXT-SESSION-BOOTSTRAP prompt (the deliverables of the Fable planning session).
