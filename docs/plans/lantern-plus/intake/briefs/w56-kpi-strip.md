TASK: Lantern Intake Wave 6 Lane W6a — Onboarding board KPI strip (local-only).

You are Codex (gpt-5.6), building in an isolated git worktree on branch `lp/w56-kpi-strip` off `lp/intake-w56` (dispatched AFTER W5a phone-mode merges, to avoid board conflicts). Pure TS/React. TDD.

## Read first
- `docs/plans/lantern-plus/intake/PRODUCT-DESIGN.md` §4 (Onboarding board — the "Board KPI strip (later wave, analytics)" note: average days-to-complete, current stalled count, completion rate; "the board must first be a work surface, not a dashboard" — the strip is a compact addition, not a takeover).
- `docs/plans/lantern-plus/intake/WAVE-PLAN.md` Wave 6 goal (KPI strip computed LOCALLY from intake state).
- Existing code:
  - `src/platform/intake/onboardingModel.ts` — `OnboardingRow` (has `stalledDays`, `isStalled`, `receivedCount`, `requiredCount`, `status`, `lastActivityAt`); `sortOnboardingRows`. Compute KPIs from these rows + intake records.
  - `src/platform/intake/intakeStore.ts` — `IntakeRecord` (created/completed timestamps for days-to-complete).
  - `src/features/intake/OnboardingBoard.tsx` — the board; add the strip in the header region (around the existing header div). `OnboardingBoardContainer.tsx`, `OnboardingBoardEmptyState.tsx`.

## Goal (plain)
A small strip at the top of the Onboarding board showing three numbers, computed entirely on the advisor's machine from local intake state (NO network, NO relay call): average days to complete (from completed intakes), current stalled count, and completion rate. It's a quiet summary above the work list, not a dashboard.

## Deliverables
1. `src/platform/intake/onboardingKpis.ts` (new, PURE): `computeOnboardingKpis(rows, records)` → `{ avgDaysToComplete: number | null, stalledCount: number, completionRate: number, completedCount, activeCount }`. Handle empty/partial data honestly (null avg when no completed intakes; rate = completed / (completed+active), guard divide-by-zero). Days-to-complete from create→complete timestamps on completed intakes.
2. `src/features/intake/OnboardingKpiStrip.tsx` (new): compact strip rendering the three stats with plain labels ("Avg days to complete", "Stalled", "Completion rate"). Light theme, design tokens, no em dashes. Graceful empty state ("No completed onboardings yet"). Accessible: each stat labeled for screen readers.
3. Wire the strip into `OnboardingBoard.tsx` header (above the row list). Do not disturb existing sort/row behavior or the `data-testid="onboarding-board"` handle.

## TDD — write first (vitest)
`src/platform/intake/onboardingKpis.test.ts`:
1. Avg days-to-complete from a mix of completed intakes with known create/complete timestamps.
2. Stalled count matches rows where `isStalled`.
3. Completion rate = completed/(completed+active), rounded sensibly; divide-by-zero → 0 (or null) with no NaN.
4. Empty input → all-empty honest result (no NaN, avg null).
5. Only completed intakes count toward avg days (in-progress excluded).
`src/features/intake/__tests__/OnboardingKpiStrip.test.tsx`:
6. Renders the three stats; empty state renders "No completed onboardings yet"; no network call is made (assert no fetch).

## Non-negotiables
- LOCAL-ONLY computation: no relay/network, no new backend surface. The relay never sees analytics.
- No restricted values anywhere near this (it's counts + averages only).
- Light theme, tokens, no em dashes. Don't break existing board tests/handles.

## Out of scope
- Relay hardening (W6b), phone mode (W5a), any per-client detail, historical charts, export. Just the three-number strip.

## Verify
`npx vitest run src/platform/intake/onboardingKpis.test.ts src/features/intake/__tests__/OnboardingKpiStrip.test.tsx`, `npx tsc --noEmit`, `npm run lint:gate`. Report exact counts. When done + committed, print `W56-KPISTRIP-LOCAL-DONE` then `DONE-EXIT:0`.
