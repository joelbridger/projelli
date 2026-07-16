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
  addWorkflowStepAttachmentRef,
  listWorkflowStepAttachmentRefs,
  removeWorkflowStepAttachmentRef,
} from './extensions/attachments';
export {
  useWorkflowTemplateStore,
  WorkflowTemplateError,
} from './workflowTemplateStore';
export { WorkflowAuthoringRuleMount } from './authoring/WorkflowAuthoringMount';
export { workflowFiltersAuthoringExtension } from './filters';
export {
  WorkflowRecordStartSlot,
  type WorkflowRecordStartSlotProps,
} from './authoring/WorkflowRecordStartSlot';
export {
  createWorkflowAuthoringLibraryComposition,
  createWorkflowRecordStartComposition,
  defineWorkflowAuthoringLibraryDescriptor,
  defaultWorkflowAuthoringLibraryComposition,
  defaultWorkflowRecordStartComposition,
  mountWorkflowRecordStarts,
  openWorkflowTemplateLibrary,
  validateWorkflowAuthoringLibraryDescriptors,
  validateWorkflowRecordStartDescriptors,
  workflowAuthoringLibraryRegistry,
  workflowRecordStartRegistry,
} from './authoring/workflowAuthoringExtensionPoints';
export type {
  WorkflowAuthoringLibraryComposition,
  WorkflowAuthoringLibraryContext,
  WorkflowAuthoringLibraryDescriptor,
  WorkflowAuthoringLibraryFilterContext,
  WorkflowAuthoringLibraryState,
  WorkflowAuthoringLibraryStateValue,
  WorkflowRecordStartComposition,
  WorkflowRecordStartContext,
  WorkflowRecordStartDescriptor,
  WorkflowRecordStartRequest,
} from './authoring/workflowAuthoringExtensionPoints';
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
