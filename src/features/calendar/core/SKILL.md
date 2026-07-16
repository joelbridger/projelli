---
name: add-calendar-foundation-consumer
description: Add a calendar grid, event editor, record quick-add, meeting list, home-calendar selector, booking-availability screen, or read-only calendar projection using the local-first calendar foundation.
---

# Add a calendar foundation consumer

Import from `@/features/calendar` only. Never import the live CRM record hook,
the generic live-record writer, a Tauri command, the legacy scheduling Zustand
store, or a file inside `calendar/core`.

## Read and create through the public doorway

```ts
import {
  createDraftFromRecord,
  toCalendarGridItems,
  useCalendarEventStore,
  type CalendarRange,
} from '@/features/calendar';

const events = useCalendarEventStore();
const range: CalendarRange = {
  startUtc: '2026-08-01T00:00:00Z',
  endUtc: '2026-09-01T00:00:00Z',
};
const grid = toCalendarGridItems(await events.listOccurrences(range));

const draft = createDraftFromRecord(
  { kind: 'household', id: 'household-1', matterId: 'matter-1', label: 'Rivera household' },
  {
    startUtc: '2026-08-04T14:00:00Z',
    endUtc: '2026-08-04T14:30:00Z',
    displayTimezone: 'America/New_York',
    calendarId: 'calendar:local',
  },
);
await events.create(draft);
```

Availability consumers use `useCalendarCapabilityStore()`,
`useBookingAvailabilityStore()`, `getBusyBlocks()`, and `getBookableSlots()`
from the same index. A public booking page receives only the result of
`toBookingPageAvailabilityConsumer()`. A slot is a calculation, not a hold or
confirmation.

## Add a scheduling screen

Follow `docs/skills/add-scheduling-contribution/SKILL.md`. Keep the screen in
its own feature, augment `SchedulingSurfaceMap` beside that screen, and append
its descriptor once without changing the scheduling shell. The feature owns
its one flag when it ships; check that flag before mounting any calendar hook.

## Add a read-only projection

Augment `CalendarProjectionMap` beside the provider and export a descriptor
whose only data method is `load`. It must declare
`source: 'external-read-only'`, check its own outer feature switch in
`isEnabled`, and return the narrow `CalendarReadProjection`. Credentials,
provider DTOs, writes, moves, deletes, holds, and confirmations do not belong
in Part A.

The one-line append rule is:

```ts
  myReadOnlyProjection,
```

Append that one physical line after the existing entries in
`calendarProjectionRegistry`, with a larger order number. Do not reorder or
edit existing descriptors. Validation rejects duplicate IDs, malformed
descriptors, and order drift. Disabled descriptors are excluded before their
loader runs.

## Proof before handoff

Use the public real-reload helper from `@/features/calendar/testing` for any
new durable calendar shape. Then run:

```bash
npm run typecheck
npm run typecheck:tests
npx vitest run src/features/calendar/core
npx vitest run tests/public-imports/calendar-foundation.compile.test.ts
npm run boundaries:check
npx vitest run tests/unit/architecture-boundaries.test.ts
```

The public import fixtures cover grid, add event, event list, meeting schedule,
record quick-add, home-calendar selection, booking availability, booking-page
presentation (through `@/features/booking`), and the external read-only slot.
Extend those fixtures whenever the public contract grows.
