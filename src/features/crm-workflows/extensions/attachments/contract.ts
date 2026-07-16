import {
  addWorkspaceDocumentRef,
  listWorkspaceDocumentRefs,
  removeWorkspaceDocumentRef,
  type WorkspaceDocumentRef,
} from '@/features/crm-documents';
import type { WorkflowStepExtensionContext } from '@/features/crm-workflows';

function currentStep(context: WorkflowStepExtensionContext) {
  const step = context.instance.snapshot.steps[context.stepId];
  if (!step) throw new Error('This workflow step is no longer available.');
  return step;
}

/** Returns the durable, workspace-relative document pointers for one workflow step. */
export function listWorkflowStepAttachmentRefs(
  context: WorkflowStepExtensionContext,
): readonly WorkspaceDocumentRef[] {
  return listWorkspaceDocumentRefs(currentStep(context).documentRefs);
}

/** Adds one already-resolved workspace document through the canonical step save callback. */
export async function addWorkflowStepAttachmentRef(
  context: WorkflowStepExtensionContext,
  reference: WorkspaceDocumentRef,
): Promise<readonly WorkspaceDocumentRef[]> {
  const step = currentStep(context);
  const saved = await context.saveStepMetadata({
    documentRefs: listWorkspaceDocumentRefs(
      addWorkspaceDocumentRef(step.documentRefs, reference),
    ),
  });
  return listWorkspaceDocumentRefs(saved.snapshot.steps[context.stepId]?.documentRefs);
}

/** Removes one workspace-relative document pointer through the canonical step save callback. */
export async function removeWorkflowStepAttachmentRef(
  context: WorkflowStepExtensionContext,
  documentPath: string,
): Promise<readonly WorkspaceDocumentRef[]> {
  const step = currentStep(context);
  const saved = await context.saveStepMetadata({
    documentRefs: listWorkspaceDocumentRefs(
      removeWorkspaceDocumentRef(step.documentRefs, documentPath),
    ),
  });
  return listWorkspaceDocumentRefs(saved.snapshot.steps[context.stepId]?.documentRefs);
}
