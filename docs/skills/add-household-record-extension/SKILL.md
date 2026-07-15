---
name: add-household-record-extension
description: Add a typed household-record action, section, tab, or extension through the CRM registries.
---

# Add a household record extension

The household screen is assembled from typed, append-only registries. A future
feature owns its descriptor and its type declaration; it does not widen
`HouseholdRecord`, add a new hand-written union, or edit the record shell.

## Choose the right registry

- **Header action:** a button beside the household title. Use
  `HouseholdHeaderActionDescriptor`, with an `id`, numeric `order`, and
  `mount(context)`. The descriptor shape is defined in
  [`recordRegistry.tsx`](../../../src/features/crm-clients/recordRegistry.tsx:54).
- **Add-menu action:** an action in the household Add menu. Use
  `HouseholdAddActionDescriptor`; the same `id`, `order`, and `mount` pattern
  applies at [`recordRegistry.tsx`](../../../src/features/crm-clients/recordRegistry.tsx:60).
- **Section:** a record-body section connected to a tab. Use
  `HouseholdSectionDescriptor` and provide its `tab` route at
  [`recordRegistry.tsx`](../../../src/features/crm-clients/recordRegistry.tsx:66).
- **Tab:** a full record tab. Use `HouseholdTabDescriptor`, including the
  route, label, icon, and component, at
  [`tabRegistry.ts`](../../../src/features/crm-clients/tabRegistry.ts:33).
- **Record extension:** typed feature data that does not belong on
  `HouseholdRecord`. Use `HouseholdRecordExtensionDescriptor`, with a stable
  namespaced `dataKey`, default value, validator, and optional editor/summary
  mounts at [`recordRegistry.tsx`](../../../src/features/crm-clients/recordRegistry.tsx:25).

## Declare the new ids beside the feature descriptor

Augment the maps in the feature module that owns the new descriptor. This makes
an unknown or misspelled id a type error. The existing compatibility layer is
the working example: it declares tab routes at
[`recordRegistryCompatibility.tsx`](../../../src/features/crm-clients/recordRegistryCompatibility.tsx:12)
and record-registry ids at
[`recordRegistryCompatibility.tsx`](../../../src/features/crm-clients/recordRegistryCompatibility.tsx:25).

```tsx
import type {
  HouseholdAddActionDescriptor,
  HouseholdHeaderActionDescriptor,
  HouseholdRecordExtensionDescriptor,
  HouseholdSectionDescriptor,
} from '@/features/crm-clients/recordRegistry';
import type { HouseholdTabDescriptor } from '@/features/crm-clients/tabRegistry';

declare module '@/features/crm-clients/recordRegistry' {
  interface HouseholdHeaderActionIdMap { review: true; }
  interface HouseholdAddActionIdMap { review_note: true; }
  interface HouseholdSectionIdMap { reviews: true; }
  interface HouseholdRecordExtensionKeyMap { 'reviews.preferences': true; }
}

declare module '@/features/crm-clients/tabRegistry' {
  interface HouseholdTabRouteMap { reviews: true; }
}
```

Use a distinctive, stable id and leave existing order values unchanged. Choose
an order between neighbors when possible; the registry sorts actions and
sections by it ([`recordRegistry.tsx`](../../../src/features/crm-clients/recordRegistry.tsx:153)).

## Add the descriptor and mount it once

Define the descriptor in the owning feature, then add its import and append it
to exactly one matching list (preserving the compatibility descriptors):

- header action → `householdHeaderActionRegistry`
- Add-menu action → `householdAddActionRegistry`
- section → `householdSectionRegistry`
- tab → `householdTabRegistry`
- record extension → `householdRecordExtensionRegistry`

The current registries are the sole mount lists at
[`recordRegistry.tsx`](../../../src/features/crm-clients/recordRegistry.tsx:144)
and [`tabRegistry.ts`](../../../src/features/crm-clients/tabRegistry.ts:42).
Keep current entries in their order. The compatibility descriptors show real
header, Add-menu, section, and extension examples at
[`recordRegistryCompatibility.tsx`](../../../src/features/crm-clients/recordRegistryCompatibility.tsx:107),
[`recordRegistryCompatibility.tsx`](../../../src/features/crm-clients/recordRegistryCompatibility.tsx:157),
[`recordRegistryCompatibility.tsx`](../../../src/features/crm-clients/recordRegistryCompatibility.tsx:244),
and [`recordRegistryCompatibility.tsx`](../../../src/features/crm-clients/recordRegistryCompatibility.tsx:253).

For an extension, `dataKey` must include a namespace dot, IDs and data keys
must be unique, and the default must pass the validator. These are enforced at
[`recordRegistry.tsx`](../../../src/features/crm-clients/recordRegistry.tsx:108).

## Verify

Run the focused registry test, type check, and lint gate:

```bash
npx vitest run src/features/crm-clients/recordRegistry.test.tsx
npx tsc --noEmit
npm run lint:gate
```
