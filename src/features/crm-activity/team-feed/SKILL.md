---
name: activity-tool-registry
description: Append one typed tool descriptor to the team activity feed without changing the registry foundation.
---

# Registering a team activity tool

The sanctioned integration is one descriptor exported by the dependent feature,
one import in `activityToolRegistry.tsx`, and one append to
`activityToolRegistry`. A dependent must not edit the descriptor types,
validation, composition, feed projection, mount behavior, or team-feed tests.

## Required pattern

Define and export exactly one typed descriptor from the dependent feature. Use
`satisfies ActivityToolDescriptor<State>` so TypeScript checks the complete
contract without widening the feature-owned state.

```tsx
import type { ActivityToolDescriptor } from '@/features/crm-activity/team-feed';
import { isEnabled } from '@/platform/flags';

type FilterSearchState = { readonly query: string };

export const activityFilterSearchTool = {
  id: 'activity-filter-search',
  order: 100,
  isEnabled: () => isEnabled('activity-filter-search'),
  mount: (context) => <ActivityFilterSearch context={context} />,
  filter: (item, context) => matchesActivityFilter(item, context.state.get()),
  renderEmptyResult: (context) => <ActivityFilterEmpty context={context} />,
} satisfies ActivityToolDescriptor<FilterSearchState>;
```

Then make the only permitted foundation edit:

```tsx
import { activityFilterSearchTool } from '../extensions/filter-search';

export const activityToolRegistry: readonly ActivityToolDescriptor[] = [
  activityFilterSearchTool,
];
```

## Constraints

- Append exactly one descriptor. Do not add a second registry, wrapper, or feed.
- Import the descriptor from the dependent feature's public package entry point.
- Keep the descriptor typed with `satisfies ActivityToolDescriptor<State>`.
- Use a unique lowercase id and a finite order. Existing entries keep their
  relative order.
- Put feature logic, state, copy, flag checks, and tests in the dependent
  feature. The registry receives only the descriptor import and array entry.
- A dark descriptor must return `false` from `isEnabled` before its mount or
  filter can receive feed data.
- Do not edit team-feed foundation code or tests to accommodate a dependent.
  Composition, validation, projection, and empty-result behavior stay owned by
  the foundation.

The dependent should prove its descriptor through the public team-feed contract
and a real registry render in its own focused tests.
