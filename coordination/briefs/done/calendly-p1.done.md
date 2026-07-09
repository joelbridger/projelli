# Calendly Scheduling Phase 1 — Done

Branch: `feat/calendly-scheduling`
Worktree: `/home/jameson/lp-calendly`
Commit pushed: `37df6661` (`feat: add scheduling availability phase one`)

## What shipped

- Added Phase 1 booking domain files under `src/features/scheduling/`:
  - `AvailabilityRule`
  - `BookingSlug`
  - `BusyFreeSnapshot`
  - `BookingRequest`
  - `BookableSlot`
- Added pure availability slot math with tests for:
  - working-hours filtering
  - meeting buffers
  - minimum notice
  - maximum booking horizon
  - busy-block subtraction
  - advisor timezone versus viewer timezone
  - DST boundary behavior
  - meeting-type-specific durations
- Added privacy-safe busy/free projection from the existing calendar read helper.
  - Projection output only contains opaque `{ startUtc, endUtc }` blocks.
  - Test asserts titles, attendees, locations, and meeting links do not leak into the snapshot.
- Added `advisorTimezone` to the profile store.
- Added local Scheduling settings UI in Settings:
  - booking slug/link placeholder
  - working hours per weekday
  - meeting type duration and buffers
  - minimum notice, max horizon, advisor timezone
  - new `data-testid` handles
  - visible copy added to `en.json`
- Updated existing Settings/i18n/architecture tests for the new seventh Settings section.

## Explicitly not built

- No server booking service.
- No public booking page.
- No calendar write commands.
- No OAuth scope changes.
- No event creation, update, delete, reminders, or video-link creation.

## Files touched

19 files in the pushed commit.

## Checks

### TDD red check

Initial focused scheduling test run failed before implementation because the new modules did not exist yet:

```text
npx vitest run src/features/scheduling/availability.test.ts src/features/scheduling/busyFreeProjection.test.ts src/features/scheduling/SchedulingSettings.test.tsx

FAIL  src/features/scheduling/SchedulingSettings.test.tsx
Error: Failed to resolve import "./SchedulingSettings"

FAIL  src/features/scheduling/availability.test.ts
Error: Failed to resolve import "./availability"

FAIL  src/features/scheduling/busyFreeProjection.test.ts
Error: Failed to resolve import "./busyFreeProjection"

Test Files  3 failed (3)
Tests  no tests
```

### Required scoped checks

```text
npm run typecheck

> advisor-prep-hero@3.3.5 typecheck
> tsc --noEmit
```

```text
npx vitest run src/features/scheduling/availability.test.ts src/features/scheduling/busyFreeProjection.test.ts src/features/scheduling/SchedulingSettings.test.tsx

RUN  v4.1.3 /home/jameson/lp-calendly

Test Files  3 passed (3)
Tests  12 passed (12)
Duration  1.16s
```

```text
node scripts/eslint-gate.mjs

✅ No ESLint regression vs baseline. (45 fingerprint(s) cleaned up vs baseline)
```

### Related tests updated for the new Settings section

```text
npx vitest run tests/unit/components/settings/SettingsContent.test.tsx tests/unit/components/settings/SettingsSections.test.tsx tests/unit/settings-nested-sections.test.tsx tests/unit/i18n/en-json-snapshot.test.ts tests/unit/architecture-boundaries.test.ts

RUN  v4.1.3 /home/jameson/lp-calendly

Test Files  5 passed (5)
Tests  99 passed (99)
Duration  3.72s
```

### Push gate

The branch push also ran the repository pre-push fast gate:

```text
pre-push: fast gate (typecheck + unit tests)…

Test Files  748 passed | 1 skipped (749)
Tests  7123 passed | 6 skipped (7129)
Duration  105.92s

✅ fast gate passed
To https://github.com/lanternplatform/lantern.git
 * [new branch]        feat/calendly-scheduling -> feat/calendly-scheduling
```

## Coordinator notes

- The placeholder link is intentionally local UI only: `https://book.advisorprephero.com/<slug>`.
- `settings->scheduling` was added to the architecture allowlist because Settings now hosts the Scheduling panel, while the scheduling feature owns booking rules and slot math.
- The OCR files were restored with `npm run copy-build-assets` before the successful push because the pre-push unit run needs those ignored local assets present.
