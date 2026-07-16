---
name: add-workflow-authoring-library-extension
description: Add a filter control or selected-template detail to the canonical workflow authoring library.
---

# Add a workflow authoring library extension

Use the public doorway only:

```tsx
import {
  defineWorkflowAuthoringLibraryDescriptor,
  type WorkflowAuthoringLibraryDescriptor,
} from '@/features/crm-workflows';
```

Create one descriptor beside the feature that owns the control or detail. Use
`defineWorkflowAuthoringLibraryDescriptor<YourTransientState>()` when the
feature needs a narrower state type; the returned descriptor is ready for the
shared heterogeneous registry. The library supplies:

- `canonicalTemplates`: the complete read-only result from the canonical async
  workflow store;
- `visibleTemplates`: the canonical records left after all enabled filters;
- `selectedTemplateId`: identity owned by the landed authoring library;
- `state`: one temporary state slot scoped by the descriptor's unique ID.

The supported slots are `mountFilterControl` above the real template results
and `renderDetail` after those results. A descriptor must implement at least one
slot. A filter implements `filter` and composes with every other enabled filter
using AND while preserving canonical source order.

Do not deep-import `WorkflowAuthoringMount`, render a second template list,
copy template records into a feature store, mutate a supplied record, or add a
feature branch to the landed editor.

## Register once

Append the descriptor as one complete entry in
`workflowAuthoringLibraryRegistry`. Do not reorder existing entries. Use a
stable lowercase namespaced ID; it also owns the descriptor's temporary state.

Use `isEnabled` for the feature's outer gate. It is checked before the
descriptor receives canonical templates or selected identity. A dark
descriptor creates no control, detail wrapper, data callback, or visual gap.

## Selection and detail

Read the selected canonical record by matching `selectedTemplateId` against
`canonicalTemplates`. If filtering removes the selection, the host rehomes it
to the first visible canonical template or clears it when none remain. Render
an honest no-result state from the slot; never display stale detail.

Filtering is read-only. A filter interaction must not call create, update,
publish, start, or any live-record writer. State is transient and must not be
put in localStorage or a CRM preference record without a separate approved
contract.

## Item 11: persistence and reload claims

This extension surface persists nothing. Its state intentionally resets on
remount, so do not claim filter reload behavior. If a later extension also
performs an approved workflow write, prove that write through a fresh
`useWorkflowTemplateStore()` reader over `crm_live_upsert` and
`crm_live_list`, following
`src/features/crm-workflows/authoring/workflowAuthoringLifecycle.live.test.tsx`.
Never use a save response, clone, or memory echo as reload proof.

## Verify

Run the public extension-point test, `WorkflowAuthoringMount.test.tsx`, the
feature's focused tests, both TypeScript checks, boundaries, architecture
guard, handle guard, i18n snapshot, token guard, and ESLint on touched files.
