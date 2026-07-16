import type { WorkflowStepExtensionDescriptor } from '@/features/crm-workflows';
import { WorkflowStepAttachments } from './WorkflowStepAttachments';

declare module '@/features/crm-workflows/workflowExtensionRegistry' {
  interface WorkflowStepExtensionIdMap {
    'workflow-step.attachments': true;
  }
}

export const workflowStepAttachmentsExtension: WorkflowStepExtensionDescriptor = {
  id: 'workflow-step.attachments',
  order: 20,
  mount: (context) => <WorkflowStepAttachments context={context} />,
};

export {
  addWorkflowStepAttachmentRef,
  listWorkflowStepAttachmentRefs,
  removeWorkflowStepAttachmentRef,
} from './contract';
