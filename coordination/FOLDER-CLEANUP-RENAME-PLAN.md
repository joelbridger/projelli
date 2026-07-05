# Folder cleanup + keepance→lantern rename — PLAN (approved by Jameson 2026-07-05)

**Sequencing (approved): DEMO FIRST → tidy folders → code-rename after the demo. Do NOT start mid-demo.**
**Decision (approved): resetting local DEV test data on the code-rename is OK** (nothing shipped to real users), so no data-migration step is required — the simpler path.

## Why this is careful, not a find-replace
Most "keepance" names are just folder labels (safe). But a few are baked into WHERE DATA + KEYS ARE STORED on the machine — blindly renaming those makes the app lose track of saved data/keys:
- **`~/.keepance` storage directory** — user/dev data lives here (30 refs in code). Rename = existing local data orphaned (acceptable per the approved reset decision).
- **OS keychain service names** (`keychain.rs`, `vault/mod.rs`) — rename orphans stored API keys + the vault master key (dev re-enters keys; acceptable).
- **`keepance-vault` crate** — a code/Cargo refactor.
- **NEVER touch:** the `matter`/`Matter`/`matter_id` facade (locked, separate rule — NOT a keepance thing).
Scope: ~113 "keepance" occurrences in lantern-plus src+src-tauri; user-facing is already largely "Advisor Prep Hero" (196 files).

## Phase A — tidy the server folders (safe; do at a calm point, can be before or after demo)
Home dir `~/` is cluttered with ~30 `keepance-*` / `kp-*` folders + loose screenshots.
1. **Archive dead loose files** (safe now): `keepance-r2a-*.png`, `kp-*.png`, `keepance-*.jpeg`, `*.csv`, stray `.md` audit files → move to `~/archive/keepance-screenshots-2026/`. Nothing references these.
2. **Rename ACTIVE support folders** (needs reference updates): `keepance-coordination`→`lantern-coordination`, `keepance` (main)→`lantern-main` or fold into `lantern`, `keepance-backups`→`lantern-backups`, `keepance-demo-data`/`keepance-web-demo`/`keepance-founder-guide`→`lantern-*`, `kp-coord`→`lantern-coord`. **Before renaming each: grep the whole server for references** (CLAUDE.md files, coordinator PLAYBOOK.md, scripts, deploy.sh, symlinks like ~/.codex/AGENTS.md) and update them in the same commit. **`keepance-coordination` is referenced by the coordinator playbook + relays — rename it LAST and update all pointers atomically.**
3. Keep `lantern` (canonical code) and `lantern-plus` (this fork) as-is for now.

## Phase B — rename "keepance"→"lantern" in the app code (risky; AFTER demo is green)
Do as its own dedicated branch + full gate (a destabilizing refactor — never right before a demo).
1. Inventory all 113 refs; categorize: (a) plain strings/comments/paths that are safe, (b) storage-path `~/.keepance`→`~/.lantern`, (c) keychain service names, (d) `keepance-vault` crate name + Cargo refs.
2. Do a mechanical rename per category with a review + `npm run gate` (tsc+vitest+eslint+cargo) after EACH category, not all at once.
3. Storage path + keychain: since dev-data reset is approved, just rename — no migration. Confirm the app boots fresh cleanly (re-enter a key, re-open a workspace).
4. Independent Codex review of the full diff before merge. This is a big diff — expect several rounds.
Estimated: a multi-hour careful project; assign a dedicated worker + Codex, coordinator reviews each category.

## Status
Approved, PLANNED, NOT started. Trigger Phase A at a calm moment; trigger Phase B only after the demo is all-green and stable.
