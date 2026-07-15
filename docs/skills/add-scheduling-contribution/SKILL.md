---
name: add-scheduling-contribution
description: Add a calendar-grid, event-editor, write-review, availability, or booking-page scheduling mount. Use when a scheduling or booking feature needs to contribute UI without editing SchedulingHome or widening the shared scheduling state.
---

# Add a scheduling contribution

Keep a contribution inside its feature folder. The scheduling shell only renders
descriptors; it must not gain a feature switch or feature-specific props.

1. Define the feature's descriptor beside its mount component. Augment
   `SchedulingSurfaceMap` from `@/platform/calendar` in that same module. The
   map intentionally has no string fallback, so a misspelled id fails typecheck.
2. Append the descriptor once to
   `src/features/scheduling/schedulingSurfaceRegistry.tsx`. Do not reorder old
   descriptors. A registry contains only descriptor metadata and mount
   functions, never screen logic.
3. Use `SchedulingStateContract` from `@/platform/calendar` for shared
   scheduling data. Keep new state feature-owned; do not turn the shared store
   into a calendar switchboard.
4. Put new calendar read, write, booking, and DTO code under
   `src/platform/calendar/`. `platform/utils/calendar-commands.ts` is a
   compatibility-only barrel for older imports.
5. Add focused tests for the mount and contract. Run:

```bash
npm run typecheck
npx vitest run src/features/scheduling/schedulingSurfaceRegistry.test.tsx
npx vitest run tests/unit/architecture-boundaries.test.ts
```
