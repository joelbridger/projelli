# Fix brief — swallow-batch: QA-45..48 P1s (verify-then-fix the swallowed-failure class)

**Lane:** cc-lantern-swallowbatch · dir `~/lp-swallowbatch` (own worktree, branch `lp/swallow-batch`). **Model:** Sonnet 5 · high.
**Read FIRST:** BUG-DB QA-45..48 + coordination/qa-campaign/static-swallow-sweep.md (findings 2-5). These are Codex STATIC findings — for each, CONFIRM the swallow against the code (read the site, trace the failure path) BEFORE fixing; note "confirmed real" vs "not actually reachable" honestly. **Rules:** NO-SHORTCUTS. TDD red-first. Codex self-review foreground/watched. PULL + reconcile before handoff. Stay in your lane (the named files); don't touch useMemoryWiring.ts (swallowp0 owns), DocxEditor internals (cleanup4), or the CRM/email outbound path (Tier B just merged there — coordinate if you must).

## The four (all the same class: a failure leaves a silent wrong/stuck state)
1. **QA-45 (P1)** MatterNotesEditorWrapper.tsx:52 — ensureMatterSync's .then has no .catch → a key-fetch/sync/crypto failure leaves `loading` true forever (permanent spinner instead of the locked/no-access panel). Fix: .catch → loading false + fail-closed panel.
2. **QA-46 (P1)** MatterSyncClient.ts:288/338 — ws close / failed local push sets offline but no reconnect loop + unsent Yjs updates not queued → teammates silently stop getting changes. Fix: reconnect-with-backoff while started, queue unsent updates.
3. **QA-47 (P1)** MeetingEntry.tsx:115/378 — DocxEditor dynamic import fails → DocxEditorComp null → falls through to false "notes pending" even when notes.docx exists. Fix: track load error + retry (same class as the merged chunk-load flake; do NOT touch DocxEditor itself, only MeetingEntry's load handling).
4. **QA-48 (P1)** TodaysMeetingsStrip.tsx:98/147 + useMeetingAutoprep.ts:97 — calendarListEvents failure → events=[] → no Today strip, no auto-prep, no error. Fix: calendar error state + retry; don't equate fetch-fail with empty.

## Gate + handoff
tsc · typecheck:tests 0 · i18n 0 · full vitest · eslint-gate · Rust if touched. Per-finding: confirmed-real? + red-first test proving the silent state is now an honest one. Handoff: which confirmed real, gate counts, self-review rounds. Push (NOT self-merged), then exactly: `WORKER-DONE: lp/swallow-batch`
