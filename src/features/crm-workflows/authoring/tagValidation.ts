import {
  FirmTagError,
  type FirmTagCatalog,
} from '@/features/crm-tags';
import type {
  WorkflowTemplateRecord,
  WorkflowTemplateStep,
} from '@/features/crm-workflows';

interface TaggedWorkflowDraft {
  readonly tagIds: readonly string[];
  readonly steps: readonly Pick<WorkflowTemplateStep, 'id' | 'tagIds'>[];
}

function validateTagIds(
  tagIds: readonly string[],
  catalog: FirmTagCatalog,
  retainedIds: readonly string[]
): void {
  const tags = new Map(catalog.tags.map((tag) => [tag.id, tag]));
  const retained = new Set(retainedIds);
  for (const id of tagIds) {
    const tag = tags.get(id);
    if (!tag) {
      throw new FirmTagError('not_found', `Unknown workflow tag: ${id}`);
    }
    if (tag.status === 'retired' && !retained.has(id)) {
      throw new FirmTagError('retired', `Retired workflow tag: ${id}`);
    }
  }
}

/**
 * Retired tags remain readable on saved templates, but cannot be newly added.
 * The workflow store still owns template shape and identity validation.
 */
export function validateWorkflowTemplateTags(
  draft: TaggedWorkflowDraft,
  catalog: FirmTagCatalog,
  previous?: WorkflowTemplateRecord
): void {
  validateTagIds(draft.tagIds, catalog, previous?.tagIds ?? []);
  const previousSteps = new Map(
    previous?.steps.map((step) => [step.id, step]) ?? []
  );
  for (const step of draft.steps) {
    validateTagIds(
      step.tagIds,
      catalog,
      previousSteps.get(step.id)?.tagIds ?? []
    );
  }
}
