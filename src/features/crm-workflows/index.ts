/**
 * Public doorway for workflow-step extensions.
 *
 * The patch helper is pure and immutable. Extensions receive the typed async
 * save callback from `WorkflowStepExtensionContext`; raw live-record storage is
 * intentionally not exported.
 */
export { patchWorkflowStepMetadata } from './workflowStepPersistence';
export type {
  WorkflowStepDocumentRef,
  WorkflowStepMetadataPatch,
} from './workflowStepPersistence';
export type {
  WorkflowStepExtensionContext,
  WorkflowStepExtensionDescriptor,
} from './workflowExtensionRegistry';
export { workflowStepExtensionRegistry } from './workflowExtensionRegistry';
export {
  useWorkflowTemplateStore,
  WorkflowTemplateError,
} from './workflowTemplateStore';
export type {
  CreateWorkflowTemplateInput,
  StartWorkflowInput,
  UpdateWorkflowTemplateInput,
  WorkflowInstanceRecord,
  WorkflowTemplateErrorCode,
  WorkflowTemplateRecord,
  WorkflowTemplateStatus,
  WorkflowTemplateStep,
  WorkflowTemplateStore,
} from './workflowTemplateStore';
