---
name: use-shared-client-context
description: Connect a feature to Lantern's one stable current-client identity. Use when a CRM, Ask, Meetings, or future client-aware surface needs to select, clear, filter by, or react to the shared household without copying client state or editing shell behavior.
---

# Use shared client context

Keep the stable household selection in `src/platform/client-context`. Do not
copy it into a feature store, URL label, or search string. Treat
`householdId` as authoritative and the name/people fields as display hints.

## Add a feature adapter

Create `sharedClientContext.ts` inside the consuming feature. Export a narrow
adapter that derives only the state that feature needs:

```ts
import type { SharedClientContextAdapter } from '@/platform/client-context';

type ExampleContext =
  | { filter: 'all' }
  | { filter: 'client'; householdId: string };

export const exampleSharedClientContextAdapter = {
  id: 'example',
  derive: (client) =>
    client
      ? { filter: 'client', householdId: client.householdId }
      : { filter: 'all' },
} satisfies SharedClientContextAdapter<ExampleContext>;
```

Export the adapter from the feature's root `index.ts`. Register that public
export in `src/app/shell/client-context/clientContextAdapterRegistry.ts`; never
deep-import another feature. Reject duplicate adapter ids.

Use `useClientContextStore((state) => state.client)` in React or
`readSharedClientContext(adapter)` outside React. Select with `setClient` and
return to the firm/all view with `clearClient`. Do not persist the selection.

## Mount behavior

Declare `clientContext: 'shared'` on the feature's `AppSurfaceDescriptor`.
`AppSurfaceRouter` is the only flag decision point, and `SharedClientSurface`
uses that descriptor metadata to show the bar. A feature must not read the
`shared-client-bar` flag itself or add a second shell condition.

## Verify

Add tests proving:

- selecting in one adapter gives every adapter the same `householdId`;
- clearing restores each feature's firm/all default;
- the adapter is registered once;
- flag off renders no bar and flag on renders it only for `shared` surfaces.

Run:

```bash
npm run typecheck
npx vitest run src/platform/client-context/clientContextStore.test.ts src/app/shell/SharedClientBar.test.tsx
npm run lint:gate
npm run boundaries:check
npm run i18n:completeness
```
