---
name: add-crm-destination
description: Add a CRM Home destination without duplicating route, rail, label, or shortcut metadata.
---

# Add a CRM Home destination

Each CRM destination owns its descriptor in its feature folder. Add its route
to the augmentable map beside that descriptor, then append the descriptor to
`crmHomeSurfaceRegistry`. Do not add a route union or a switch in `CrmHome`.

```tsx
import type { CrmHomeSurfaceDescriptor } from '@/features/crm-home/registryTypes';

declare module '@/features/crm-home/registryTypes' {
  interface CrmHomeRouteMap {
    'meeting-prep': true;
  }
}

export const meetingPrepSurface: CrmHomeSurfaceDescriptor = {
  id: 'meeting-prep',
  route: 'meeting-prep',
  labelKey: 'crm.home.destinations.meeting-prep',
  icon: CalendarDays,
  rail: { group: 'home', order: 260 },
  parentRoute: 'today',
  shortcut: 'j',
  Component: MeetingPrepSurface,
};
```

Add the matching key to all three locale catalogs, then append the descriptor
to `src/features/crm-home/registry.ts`. Existing entries stay in their current
order. The registry test checks route and shortcut uniqueness, parent routes,
and that every descriptor label resolves in every locale.

Run:

```bash
npx vitest run --config src/features/crm-home/vitest.config.ts
npm run typecheck
```

The route map deliberately has no catch-all string entry. A misspelled route
must fail typecheck. CRM is still one composite boundary feature today; once
the wider boundary rule is flipped to per-folder ownership, this descriptor
and its module augmentation move with the owning feature folder while the
registry remains the sole append-only mount list.
