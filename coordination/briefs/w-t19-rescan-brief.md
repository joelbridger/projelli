ROLE: Small fix worker — deliver Wave 1 Task 19, which a reachability audit found was silently never built (no deferral recorded; the Wave-1 lane relay lost it). One task, TDD, TS-only.

WORKDIR: ~/lp-t19 (git worktree, branch lp/wave1-task19-rescan off current origin/lantern-plus — pull first). NEVER touch ~/keepance or ~/lantern-plus directly. NOT self-merged — the coordinator merges.

THE TASK — Wave 1 Task 19 "v2 trigger: scheduled generation while the app is running (gated)": read the FULL task spec in docs/plans/lantern-plus/2026-07-02-wave-1-calendar-auto-prep.md (section "### Task 19", around line 5843) and implement it EXACTLY as spec'd:
- A rescan interval (`useAutoprepRescan` + `RESCAN_INTERVAL_MS` in src/features/meetings/useMeetingAutoprep.ts) so briefs for meetings ADDED during the day get prepared without reopening the app. NO OS-level scheduling — app must be open.
- Mount it from TodaysMeetingsStrip.tsx (it owns today's events + the other autoprep hooks — see useMeetingAutoprep/useBriefStaleness mounts at ~line 125).
- One honest copy line in CalendarConnect.tsx per the spec ("while the app is open" phrasing — plain language, light theme untouched).
- Tests: new tests/unit/meetings/autoprep-rescan.test.ts per the spec's Step 1 (the failing test is written out in the plan — start from it), plus extend brief-queue tests if the spec says so.
- Reuse calendarListEvents(todayWindowUtc()), avoid duplicate prep work (respect the existing queue's dedup), clean up the interval on unmount, and DON'T rescan while a calendar sync event is mid-flight if the spec addresses that.

VERIFY ANCHORS BY SYMBOL — the plan was written 2026-07-02 and the tree has moved.

ENVIRONMENT: TS-only, no cargo. `npx vitest run tests/unit/meetings/` for the fast loop; before handoff: `npx tsc --noEmit` + full `timeout 1150 npx vitest run`.

RULES: TDD; self-converge via codex-review on your diff to a clean round; evidence handoff (HEAD SHA, test counts, drifts, "NOT self-merged"); sentinel as the very LAST line: WORKER-DONE: lp/wave1-task19-rescan ready for review
