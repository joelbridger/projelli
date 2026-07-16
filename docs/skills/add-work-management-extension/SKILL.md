---
name: add-work-management-extension
description: Add a typed workflow, task, pipeline-view, or opportunity-field extension through the work-management registries.
---

# Add a work-management extension

Workflows, tasks, and pipeline are shells around typed, append-only registries.
A future feature owns its descriptor and its type declaration beside its
implementation. It does not add a feature-specific branch to `Workflows.tsx`,
`Tasks.tsx`, or `CrmPipelineSurface.tsx`.

## Choose the registry

- Workflow step UI or data: `workflowStepExtensionRegistry`.
- Workflow template or run rule: `workflowRuleRegistry`.
- Task detail field: `taskFieldRegistry`.
- Task toolbar or record action: `taskActionRegistry`.
- Task starting point: `taskTemplateRegistry`.
- Pipeline screen or view: `pipelineViewRegistry`.
- Opportunity editor field: `opportunityFieldRegistry`.

The workflow contracts live in
`src/features/crm-workflows/workflowExtensionRegistry.tsx`, task contracts in
`src/features/crm-tasks/taskExtensionRegistry.tsx`, and pipeline contracts in
`src/features/crm-pipeline/pipelineExtensionRegistry.tsx`.
Consumers outside those features use only the matching feature `index.ts`.
For example, `workflowStepExtensionRegistry` and its descriptor/context types
are exported from `@/features/crm-workflows`.

## Declare the id beside the descriptor

Augment the matching map in the feature module that owns the descriptor. This
makes an unknown or misspelled id fail type checking.

```tsx
declare module '@/features/crm-tasks/taskExtensionRegistry' {
  interface TaskFieldIdMap {
    'attachments.files': true;
  }
}

export const attachmentField: TaskFieldDescriptor = {
  id: 'attachments.files',
  order: 30,
  mount: (context) => <AttachmentField task={context.task} />,
};
```

Use a stable, namespaced id for new capability. Keep existing order values
unchanged and choose an order between neighboring entries when possible.

## Register once

Append the descriptor to exactly one matching registry. Do not reorder or
clean up existing entries. The compatibility descriptors show how all current
behavior is preserved:

- `workflowExtensionRegistryCompatibility.tsx`
- `taskExtensionRegistryCompatibility.tsx`
- `pipelineExtensionRegistryCompatibility.tsx`

For one workflow-step extension, import its one descriptor into
`workflowExtensionRegistry.tsx` and add exactly one final array entry:

```tsx
import { workflowStepAttachmentsExtension } from './extensions/attachments';

export const workflowStepExtensionRegistry: readonly WorkflowStepExtensionDescriptor[] = [
  ...legacyWorkflowStepExtensions,
  workflowStepAttachmentsExtension,
];
```

The extension package owns the descriptor and its ID augmentation. Other
features read the finished registry only through `@/features/crm-workflows`;
they do not mutate it or import the private registry file.

Registries contain mount metadata only. Keep persistence, validation, and
business rules in the feature that owns the descriptor. Put new user-facing
copy in that feature's `locales/en.json`, `locales/es.json`, and
`locales/de.json` shards; do not edit the shared locale catalogs.

## Item 11: Prove a real save and reload

Task-family tests import the test-only public entry point instead of
hand-building a memory echo. `roundTripTaskRecord` creates through the public
task store, saves through the canonical encrypted live-record route, discards
that mounted store, opens a fresh store, and returns the reloaded snapshot.

```tsx
import { roundTripTaskRecord } from '@/features/crm-tasks/testing';

const reloaded = await roundTripTaskRecord({
  title: 'Prepare annual review',
  due: '2026-08-03',
  tagIds: ['tag:review'],
});

expect(reloaded).toMatchObject({
  title: 'Prepare annual review',
  due: '2026-08-03',
  tagIds: ['tag:review'],
});
```

The test still supplies its normal Tauri boundary mock. That mock must persist
`crm_live_upsert` input and return it later from `crm_live_list`. Do not replace
the helper with `structuredClone(created)` or assertions against the save
response; neither proves that a fresh reader can recover the task.

## Verify

Run the three focused registry tests, the affected screen tests, type checking,
lint, boundaries, locale completeness, and the architecture DAG guard:

```bash
npx vitest run \
  src/features/crm-workflows/workflowExtensionRegistry.test.tsx \
  src/features/crm-tasks/taskExtensionRegistry.test.tsx \
  src/features/crm-pipeline/pipelineExtensionRegistry.test.tsx \
  src/features/crm-pipeline/CrmPipelineSurface.test.tsx
npm run typecheck
npm run lint:gate
node scripts/check-boundaries.mjs
npm run i18n:completeness
npx vitest run tests/unit/architecture-boundaries.test.ts
```
