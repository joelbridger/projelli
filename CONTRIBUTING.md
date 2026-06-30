# Contributing to Advisor Prep Hero

This is the source for **Advisor Prep Hero** (internal codename: Lantern), a commercial, proprietary desktop application. It is not an open-source project and we are not accepting external pull requests.

## Found a bug or have feedback?
Email **developers@keepance.com** (or open an issue with the template). Please include your OS, app version, and steps to reproduce.

## For maintainers / AI sessions working in this repo
- Read **`REPO_GUIDE.md`** first (60-second orientation), then **`CLAUDE.md`** and **`ARCHITECTURE.md`**.
- The live branch is **`keepance-3.0`**. Start new work in a fresh git worktree off it.
- Every change must pass `npm run gate` (typecheck + tests + brand/identity checks + ESLint + Rust tests) before merge. Never push a red gate.
- Never rename the engine identifiers `matter` / `matter_id` / `Matter` or the license tier codes (`personal` / `professional` / `practice`).
