## Polish round (timezone)

Changed the Scheduling surface so preview times and booking request times render in the advisor timezone from the profile store, with browser/OS timezone as the fallback. The saved slot data still stays in UTC.

Small polish:
- Availability weekday inputs continue to read and write advisor-local clock times such as `09:00`, and the preview now proves those local hours become the right UTC slot underneath.
- The "Next open slots" card keeps stable heading spacing and no longer stretches when the Upcoming list changes size.

Checks:

```text
npm run test -- src/features/scheduling

Test Files  4 passed (4)
Tests  17 passed (17)
```

```text
npm run typecheck

tsc --noEmit
passed
```

```text
npm run lint:gate

No ESLint regression vs baseline. (45 fingerprint(s) cleaned up vs baseline)
```
# Calendly Scheduling Phase 2 — Advisor Surface UI

## What shipped

- Added the top-bar Scheduling calendar button (`data-testid="scheduling-topbar-button"`).
- Added the full Scheduling surface in the main app area, using `SurfaceHeader` and the standard `RailShell` / `RailShellHeader` pattern.
- Added Scheduling rail sections: Upcoming, Availability, and Meeting types.
- Added the booking-link card with Copy, Preview, Share, and the required privacy `TrustNote`.
- Added Upcoming rows for local booking requests, with quiet confirmed status and loud pending status plus inline Confirm / Decline.
- Added Availability working-hours controls, folded Advanced settings, and a “Next open slots” preview powered by the Phase 1 availability engine.
- Added Meeting types list plus add/edit SlidePanel for name, duration, and buffers.
- Extended the Phase 1 scheduling store with local booking requests, confirm/decline actions, and add/edit/remove meeting type actions.
- Added focused Scheduling surface tests and updated i18n keys in `en`, `es`, and `de`.

## Design-system notes

- Matched the current post-overhaul surface pattern: `SurfaceHeader`, `RailShell`, `RailShellHeader`, `Card`, `Button`, `IconButton`, `EmptyState`, `TrustNote`, `QuietStatus`, and `SlidePanel`.
- No new color system, page shell, card style, or dark theme was added.
- One small deviation: there is no exported `kp` toggle primitive yet, so weekday availability uses the same switch classes already used by the existing Settings toggle. This keeps the look native, but it is not a dedicated `kp` component.

## Checks run

### `npm run typecheck`

```text
> advisor-prep-hero@3.3.5 typecheck
> tsc --noEmit
```

Result: passed.

### Scheduling and language guard tests

Command:

```text
npx vitest run src/features/scheduling/availability.test.ts src/features/scheduling/busyFreeProjection.test.ts src/features/scheduling/SchedulingSettings.test.tsx src/features/scheduling/SchedulingHome.test.tsx tests/unit/i18n/en-json-snapshot.test.ts tests/unit/i18n/locale-coverage.test.ts
```

Output:

```text
RUN  v4.1.3 /home/jameson/lp-calendly

Test Files  6 passed (6)
Tests  26 passed (26)
Duration  1.65s
```

### `node scripts/eslint-gate.mjs`

```text
✅ No ESLint regression vs baseline. (45 fingerprint(s) cleaned up vs baseline)
```

### Pre-push fast gate

```text
Test Files  749 passed | 1 skipped (750)
Tests  7127 passed | 6 skipped (7133)
✅ fast gate passed
```

## Git

- Commit: `ab3bb028 feat: add advisor scheduling surface`
- Pushed: `feat/calendly-scheduling`
- Files touched: 12
