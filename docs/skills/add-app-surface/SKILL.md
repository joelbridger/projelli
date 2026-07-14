---
name: add-app-surface
description: Add a typed top-level app surface without breaking the shell registry or feature boundaries.
---

# Add an app surface

Use this recipe when a feature needs a new top-level shell surface. The app
surface registry is the one shared mount list; the feature owns its descriptor.
That split is deliberate: the shell composes features, but a feature's UI and
metadata stay in its own folder.

## 1. Create the feature-owned surface module

Create `src/features/<surface>/`, normally with `appSurface.tsx` (and the
surface component(s) it renders). Keep feature UI, state, and feature-only
helpers in that folder. A feature may import `platform`, `ui`, and `lib`, but it
must not import another feature. Shared capability needed by two or more
features belongs in `platform` instead. This is the enforced dependency rule in
[`ARCHITECTURE.md`](../../../ARCHITECTURE.md#L16-L39) and
[`ARCHITECTURE.md`](../../../ARCHITECTURE.md#L112-L117).

The feature module must register its new ID by augmenting the central map. The
map intentionally has no catch-all string entry, so an unknown or misspelled
surface ID fails TypeScript checking
([`src/platform/types/navigation.ts:1-24`](../../../src/platform/types/navigation.ts#L1-L24)).

```tsx
import { CalendarDays } from 'lucide-react';
import { createElement } from 'react';
import type { AppSurfaceDescriptor } from '@/app/shell/registry/types';
import { MeetingsSurface } from './MeetingsSurface';

declare module '@/platform/types/navigation' {
  interface AppSurfaceMap {
    meetings: true;
  }
}

export const meetingsSurface: AppSurfaceDescriptor = {
  id: 'meetings',
  labelKey: 'meetings.surface.title',
  icon: CalendarDays,
  placement: 'primary',
  order: 40,
  clientContext: 'firm',
  errorLabel: 'Meetings',
  render: (runtime) => createElement(MeetingsSurface, { runtime }),
};
```

The `import` statements make this a module, which is required for the
`declare module` augmentation. Put the augmentation beside the descriptor so
the feature adds and documents its own ID; do not edit the central ID map for a
new feature.

## 2. Fill in every descriptor field

`AppSurfaceDescriptor` is the source of truth at
[`src/app/shell/registry/types.ts:32-49`](../../../src/app/shell/registry/types.ts#L32-L49).

| Field | What to supply |
| --- | --- |
| `id` | The newly augmented `AppSurfaceMap` key. It is typed as `AppSurfaceId`, which is the app-wide `AppSurface` union ([`types.ts:6`](../../../src/app/shell/registry/types.ts#L6)). |
| `labelKey` | A namespaced translation key, such as `meetings.surface.title`. A dot is required: registry validation rejects an un-namespaced key ([`appSurfaceRegistry.ts:65-70`](../../../src/app/shell/registry/appSurfaceRegistry.ts#L65-L70)). |
| `legacyLabel` | Optional old visible label. Use it only when carrying an unchanged label through the shell refactor. New surfaces use `labelKey` alone, but the key must exist even if a legacy label masks it ([`types.ts:22-31`](../../../src/app/shell/registry/types.ts#L22-L31)). |
| `icon` | The `LucideIcon` used by shell navigation. |
| `placement` | Where the shell puts it: `primary`, `utility`, or `hidden` ([`types.ts:7`](../../../src/app/shell/registry/types.ts#L7)). |
| `order` | Numeric order within its placement. Existing ordering is sorted by this number ([`appSurfaceRegistry.ts:119-127`](../../../src/app/shell/registry/appSurfaceRegistry.ts#L119-L127)). Choose a stable value without renumbering existing surfaces. |
| `clientContext` | One of `shared`, `firm`, or `preserve-hidden` ([`types.ts:8`](../../../src/app/shell/registry/types.ts#L8)); select the lifecycle/context behavior the surface needs. |
| `errorLabel` | Plain, human-readable name shown by shell error handling. |
| `render` | A function receiving `AppSurfaceRuntime` and returning React content. It owns mounting and any lazy-loading behavior; there is no separate loader hook ([`types.ts:22-27`](../../../src/app/shell/registry/types.ts#L22-L27)). |
| `parentRoute` | Optional parent surface ID when this surface belongs beneath another route. |
| `shortcuts` | Optional read-only shortcut list. Each shortcut must be globally unique after trimming and lowercasing ([`appSurfaceRegistry.ts:72-79`](../../../src/app/shell/registry/appSurfaceRegistry.ts#L72-L79)). |
| `resolveNavigation` | Optional feature-specific handler for a `NavigationTarget` plus runtime. |
| `commands` | Optional command descriptors. Each command has `id`, `labelKey`, and optional `shortcut` ([`types.ts:16-20`](../../../src/app/shell/registry/types.ts#L16-L20)). |

Add the translation for `labelKey` in the normal locale source. Never use
`legacyLabel` to avoid creating the translation key.

## 3. Add exactly one registry line

Append one registration to the end of
`appSurfaceRegistry` in
[`src/app/shell/registry/appSurfaceRegistry.ts:22-43`](../../../src/app/shell/registry/appSurfaceRegistry.ts#L22-L43).
Do not reorder, replace, or otherwise edit existing registrations.

For an eager surface, add one static import and append its descriptor:

```ts
import { meetingsSurface } from '@/features/meetings/appSurface';

// Append at the end of appSurfaceRegistry:
meetingsSurface,
```

For a lazy surface, add no shared import. Append the one loader line instead:

```ts
() => import('@/features/meetings/appSurface').then((m) => m.meetingsSurface),
```

The registry accepts either a descriptor or a function returning a descriptor
promise ([`types.ts:51-53`](../../../src/app/shell/registry/types.ts#L51-L53)).
Lazy registrations make the registry initially not ready, then the runtime
resolves and validates all descriptors before use
([`appSurfaceRegistry.ts:85-116`](../../../src/app/shell/registry/appSurfaceRegistry.ts#L85-L116),
[`useAppSurfaceRegistry.ts:15-46`](../../../src/app/shell/runtime/useAppSurfaceRegistry.ts#L15-L46)).
Use lazy registration when deferring the feature bundle is worth the loading
state; otherwise prefer the straightforward eager descriptor.

## 4. Prove it is safe

Run these for every new surface:

```bash
npm run typecheck
npx vitest run src/app/shell/registry/appSurfaceRegistry.test.tsx
npx vitest run tests/unit/architecture-boundaries.test.ts
```

If the registration is lazy, also run:

```bash
npx vitest run src/app/shell/runtime/useAppSurfaceRegistry.test.tsx
```

The registry tests prove the current mount list and reject duplicate IDs,
duplicate normalized shortcuts, and invalid label keys
([`appSurfaceRegistry.test.tsx:28-76`](../../../src/app/shell/registry/appSurfaceRegistry.test.tsx#L28-L76)).
The lazy test proves the loading fallback and post-load duplicate validation
([`useAppSurfaceRegistry.test.tsx:41-64`](../../../src/app/shell/runtime/useAppSurfaceRegistry.test.tsx#L41-L64)).
Add focused tests for any new surface behavior as well.

## Boundary rules

- The feature owns the descriptor and module augmentation; the shell owns only
  the one append-only registry entry.
- Keep the shared registry as a mount list, not a place for feature logic,
  feature components, or feature-specific imports beyond an eager descriptor
  import.
- Never add a string index signature to `AppSurfaceMap`; it would allow
  unregistered IDs and defeat the type-safety guarantee.
- Never reorder existing registry entries. Their list order remains stable even
  though shell placement order is calculated from `order`.
- Never duplicate a surface ID or normalized shortcut. Let registry validation
  protect the global namespace.
- New surfaces use `labelKey`; `legacyLabel` is compatibility-only.
- Do not add a second lazy-loading mechanism. `render` owns mounting/loading,
  and registry loaders are the only optional deferred registration mechanism.
