/**
 * Public authoring doorway. Operations are the landed canonical workflow
 * doorway, not a second authoring store.
 */
export {
  useWorkflowTemplateStore,
  WorkflowTemplateError,
} from '@/features/crm-workflows';
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
} from '@/features/crm-workflows';
export { workflowAuthoringRuleDescriptor } from './workflowRuleDescriptor';
