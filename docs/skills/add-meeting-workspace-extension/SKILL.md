---
name: add-meeting-workspace-extension
description: Add a typed meeting panel, header action, or insight without editing MeetingEntry or growing meetingStore.
---

# Add a meeting workspace extension

The active `MeetingEntry` page maps the panel, header-action, and insight
registries directly. Feature folders own descriptors; the registries only
compose and validate them. A new descriptor needs zero `MeetingEntry` edits.
Do not add a new switch to `MeetingEntry.tsx`, a feature-specific field to
`meetingStore.ts`, or business logic to a registry file.

## Choose one registry

- **Panel:** a selectable meeting tab and its mounted content. Use
  `MeetingPanelDescriptor` from
  [`meetingPanelRegistry.ts`](../../../src/features/meetings/meetingPanelRegistry.ts).
- **Header action:** a visible action or action group in the meeting header.
  Use `MeetingHeaderActionDescriptor` from
  [`meetingHeaderActionRegistry.ts`](../../../src/features/meetings/meetingHeaderActionRegistry.ts).
- **Insight:** a versioned derived artifact plus its settings and meeting/client
  summaries. Use `MeetingInsightDescriptor` from
  [`meetingInsightRegistry.ts`](../../../src/features/meetings/meetingInsightRegistry.ts).

The shared contracts live in
[`meetingWorkspaceTypes.ts`](../../../src/features/meetings/meetingWorkspaceTypes.ts).
Compatibility examples for today's Recording, Transcript, Summary, Send,
review, and utilities UI live in
[`meetingWorkspaceCompatibility.tsx`](../../../src/features/meetings/meetingWorkspaceCompatibility.tsx).

## Declare the id beside the feature

Augment the matching map in the module that owns the descriptor. These maps do
not have a string fallback, so a typo fails TypeScript.

```tsx
import type { MeetingPanelDescriptor } from '@/features/meetings/meetingPanelRegistry';

declare module '@/features/meetings/meetingWorkspaceTypes' {
  interface MeetingPanelIdMap {
    follow_up: true;
  }
}

export const followUpPanel: MeetingPanelDescriptor = {
  id: 'follow_up',
  order: 40,
  labelKey: 'meetings.follow-up.tab-label',
  mount: (context) => <FollowUpPanel meetingDir={context.meetingDir} />,
};
```

Header actions augment `MeetingHeaderActionIdMap`; insights augment
`MeetingInsightIdMap`. Keep the declaration beside the descriptor so the
feature owns both its name and implementation.

## Fill in the complete contract

Every panel supplies a finite `order`, namespaced `labelKey`, and
`mount(context)`.

Every header action supplies a finite `order`, namespaced `labelKey`, one of
the `primary`, `secondary`, or `menu` placements, and `mount(context)`. The
mount decides whether the action is currently visible or enabled; the shell
does not learn feature rules.

Every insight must supply all of these fields:

- a positive integer `version`;
- explicit meeting/client summary `mounts` flags (artifact-only insights set
  both to `false`);
- an explicit `prerequisites` list, including an empty list when none exist;
- a versioned `artifactStore` with matching read/write behavior;
- an `artifactProducer` with a stable artifact id and async producer;
- a non-empty set of feature-owned `selectors`;
- a namespaced `settings` descriptor and mount;
- both `renderMeetingSummary` and `renderClientSummary`.

Keep the artifact store, selectors, producer, settings UI, and renderers beside
the insight feature. Store its settings and derived state there too. Never add
insight-specific state to `meetingStore`; that store is only for durable core
meeting identity, artifacts, and shared recording lifecycle.

## Add exactly one registration

Import the feature-owned descriptor in the matching registry and append one
entry. Do not reorder existing entries. The getters sort by `order` and retain
registration order when two values tie. Validation rejects duplicate ids and
incomplete contracts before anything mounts.

If the descriptor adds visible copy, add the same namespaced keys to the
meeting feature shards:

```text
src/features/meetings/locales/en.json
src/features/meetings/locales/es.json
src/features/meetings/locales/de.json
```

Do not edit the base locale catalogs.

## Verify

Run the focused registry and current meeting-workspace tests, then the project
checks:

```bash
npx vitest run tests/unit/meetings/meeting-registries.test.tsx tests/unit/meetings/meeting-entry-r7.test.tsx
npm run typecheck
npm run lint:gate
node scripts/check-boundaries.mjs
npm run i18n:completeness
npx vitest run tests/unit/architecture-boundaries.test.ts
```

Add a focused test for the new feature. It should prove the registered mount is
reachable and its versioned artifact store reads/writes without editing
`MeetingEntry` or `meetingStore`.
