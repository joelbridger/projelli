# Build brief — cleanup batch 2: typecheck:tests to green + useEntityLabel locale support

**Lane:** cc-lantern-cleanup2 · dir `~/lp-cleanup2` (own worktree, branch `lp/cleanup-batch2`). **Model:** Sonnet 5 · high.
**Rules:** TDD where behavior changes (item 2). Stay in your lane — do NOT touch: the meetings list/scan path (`ClientMeetingsTab.tsx` product code — meetpersist owns it), `useMemoryWiring.ts`, `src/platform/browserGuard/`, client-creation/Ask-lifecycle paths (qafix4 owns). Test-file type fixes in item 1 are fine even for meetings test files — types only, no behavior edits. Self-converge via `codex-review --base origin/lantern-plus`. PULL origin/lantern-plus + reconcile before handoff (tip moves fast). Unique dev-server port. No interactive menus.

## Scope
1. **`npm run typecheck:tests` exits 2 on the tip — 7 TS errors** in tests/unit/{audit-persistence,dictation-to-meeting,meeting-store}.test.ts (runtime-green tests with wrong types, accumulated across the meetings merges). Fix the TYPES (correct the test's type usage, or the source types if the test exposes a genuinely wrong signature — state which per error). Zero behavior changes to passing tests. End state: `npm run typecheck:tests` exit 0.
2. **useEntityLabel() ignores locale (flagged by the i18n lane):** the client/matter/household noun varies by profession pack but is hardcoded English in all four packs — every `entityLabel.*` string stays English in de/es across dozens of call sites. Wire the profession-pack nouns through the i18n system (keys per profession per form in en/de/es.json), keeping the profession-switching behavior identical in English. Verify live once in German (screenshot: a surface that uses entityLabel showing the translated noun). Keep `npm run i18n:check` at 0.

## Gate + handoff
`npx tsc --noEmit` clean · `npm run typecheck:tests` clean (the point) · `npm run i18n:check` 0 · full `npx vitest run` green · eslint-gate clean. Handoff: HEAD SHA, gate counts, per-error fix notes for item 1, screenshot path for item 2, self-review rounds. Push (NOT self-merged), then exactly: `WORKER-DONE: lp/cleanup-batch2`
