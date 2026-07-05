# Build brief — browser-build honesty: two-tab silent data loss (QA-15 P1) + misleading rebuild message (QA-13)

**Lane:** cc-lantern-webguard · dir `~/lp-webguard` (own worktree, branch `lp/browser-tab-guard`). **Model:** Sonnet 5 · high.
**Rules:** stay in your lane. NO-SHORTCUTS rule applies (core app): pick the robust fix, state trade-offs in the handoff. TDD. Self-converge via `codex-review --base origin/lantern-plus` before handoff. No interactive menus — `COORDINATOR:` plain-text for blockers.

## Context
The browser build matters: a live web demo is a stated product health signal. Repro evidence + mechanism: BUG-DB QA-15/QA-13 + `coordination/qa-campaign/evidence/qa3-20260704/evidence.md`.

## Scope
1. **QA-15 (P1, deterministic silent data loss):** two browser tabs on the same workspace clobber each other — zustand/persist to localStorage, last-write-wins, no cross-tab sync, no conflict check. Desktop is unaffected (single-instance guard) — this is a BROWSER-build guard. Robust direction (your call between these two, stated): (a) single-writer gate — BroadcastChannel/`storage`-event detection so a second tab gets a clear "This workspace is already open in another tab" takeover/read-only screen (simplest honest fix, kills the loss class outright); or (b) live cross-tab state sync (bigger; only if genuinely clean here). Whichever you choose: the data-loss repro from evidence.md must become impossible, proven by a test (jsdom two-store simulation or Playwright two-context spec on a unique port).
2. **QA-13 (P2):** the browser build shows "This client's memory needs to rebuild… try again in a moment" forever for the no-Tauri case (the classifier buckets "no backend" into a retry-suggesting message). Make the no-Tauri case its own honest state: this feature needs the desktop app — no false "try again". Keep the real transient-rebuild message for actual transient cases.

## Gate + handoff
`npx tsc --noEmit` clean · full `npx vitest run` green · eslint-gate clean · your new tests red-first where practical. Dev servers on a UNIQUE port only (`--port NNNNN --strictPort`). Handoff: HEAD SHA, gate counts, chosen approach + why, self-review rounds. Push your branch (NOT self-merged), then exactly: `WORKER-DONE: lp/browser-tab-guard`
