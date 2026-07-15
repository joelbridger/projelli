---
name: add-client-directory-tool
description: Add an isolated client-directory tool, action, rail, or view through the typed CRM directory registries.
---

# Add a client-directory extension

The active Clients / Directory screen is assembled from four typed registries:
`directoryToolRegistry`, `directoryActionRegistry`, `directoryRailRegistry`,
and `directoryViewRegistry`. A feature owns its descriptor and declares its ID
beside that descriptor. The directory shell remains generic.

## Pick one registry

- **Tool:** a directory control such as selection, sorting, or filtering.
- **Action:** a durable operation such as export, tagging, delete, or bulk update.
- **Rail:** a side panel or contextual secondary area.
- **View:** one complete directory result view.

Each descriptor has a stable `id`, numeric `order`, and `mount(context)`.
`DirectoryContext` gives every descriptor the same query, selection, sort,
filters, records, and repository boundary. Selection state belongs to a
selection tool; actions do not own that shared state.

## Declare the ID beside the descriptor

```tsx
import type { DirectoryToolDescriptor } from '@/features/crm-clients/directoryRegistry';

declare module '@/features/crm-clients/directoryRegistry' {
  interface DirectoryToolIdMap { 'advisor-filters': true; }
}

export const advisorFilters: DirectoryToolDescriptor = {
  id: 'advisor-filters',
  order: 100,
  mount: (context) => <AdvisorFilters context={context} />,
};
```

The central maps intentionally have no string index signature. A misspelled ID
must fail type checking. Do not add a fixed union or widen `DirectoryContext`
for one feature; put feature-local state behind its descriptor component.

## Mount once and verify

Append the descriptor to the matching registry only. Keep all existing entries
in their stable order. Registry entries contain only metadata and mount
functions; feature UI stays in its feature folder.

Run:

```bash
npx vitest run src/features/crm-clients/directoryRegistry.test.tsx
npm run typecheck
npm run lint:gate
node scripts/check-boundaries.mjs
npm run i18n:completeness
npx vitest run tests/unit/architecture-boundaries.test.ts
```
