---
name: add-workflow-record-start
description: Add a typed one-shot workflow start flow for a household record.
---

# Add a workflow record start

Use the public authoring doorway only:

```tsx
import {
  openWorkflowTemplateLibrary,
  type WorkflowRecordStartDescriptor,
  useWorkflowTemplateStore,
} from '@/features/crm-workflows';
```

Create one feature-owned descriptor beside the flag-gated start UI. Its
`WorkflowRecordStartContext` contains three authoritative values:

- `request`: the unchanged `kind: 'workflow'` household request from the real
  record action;
- `household`: the normalized `{ id, label, matterId? }` input accepted by
  `WorkflowTemplateStore.start()`;
- `onRequestConsumed`: the existing one-shot route callback.
- `openTemplateLibrary`: a host-supplied action that opens the landed canonical
  authoring library and consumes the request once. Call it through
  `openWorkflowTemplateLibrary(context)` so a missing sanctioned host fails
  loudly instead of leaving a dead button.

Do not deep-import the authoring mount, write a live record directly, or create
a second workflow store. The enabled child lists canonical templates through
`useWorkflowTemplateStore().list()` and starts through `store.start()`.

## Register once

Append the descriptor as one complete entry in `workflowRecordStartRegistry`.
Do not reorder existing entries. The public `WorkflowRecordStartSlot` is the
only sanctioned host mount; it accepts only the already-landed `addRequest`,
`onAddRequestConsumed`, household choices, and current template identity. The
slot normalizes the request, retains the matching household's `matterId`, and
calls `mountWorkflowRecordStarts()`. A dependent must not add its own scan,
lookup, context construction, or rendered child to `Workflows.tsx`. Wiring the
generic slot into that shared host is a coordinator-owned composition change,
not part of an extension lane.

Put the feature-flag check in the descriptor's `isEnabled`. The host checks it
before calling `mount`, so a dark feature cannot receive the request, create a
store, load templates, or leave wrapper spacing behind. The mounted enabled
child then owns every canonical store read.

## Preserve the one-shot lifecycle

- A resolved canonical start calls `onRequestConsumed()` once.
- Explicit cancel calls it without writing.
- A failed start does not consume the request.
- A rerender or later route visit must not replay a consumed request.

Draft templates remain unavailable. Keep the canonical
`WorkflowTemplateError` and its `template_not_published` code instead of
copying the publication rule into a new persistence path.

When no published template exists, call
`openWorkflowTemplateLibrary(context)`. The slot consumes the one-shot request
and renders the existing `WorkflowAuthoringRuleMount`; do not guess a route,
clear the request without navigation, or build another template library.

## Item 11: prove a real save and reload

A start claim requires the landed canonical live-record harness. Start through
one `useWorkflowTemplateStore()` mount, unmount it, mount a fresh store reader,
and call `getInstance()` there. The Tauri mock must retain the
`crm_live_upsert` input and return it from a later `crm_live_list` call.

Never prove reload with the `start()` response, `structuredClone(started)`, a
shared in-memory store object, or a save echo. The reference harness is
`src/features/crm-workflows/authoring/workflowAuthoringLifecycle.live.test.tsx`.

## Verify

Run the public extension-point test, `WorkflowRecordStartSlot.test.tsx`, the
record-start feature tests, the live workflow lifecycle harness, both
TypeScript checks, boundaries, architecture guard, handle guard, i18n snapshot,
token guard, and ESLint on touched files.
