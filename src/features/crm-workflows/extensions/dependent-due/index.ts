import { createElement } from 'react';
import type { WorkflowStepExtensionDescriptor } from '@/features/crm-workflows';
import { WorkflowDependentDue } from './WorkflowDependentDue';

declare module '@/features/crm-workflows/workflowExtensionRegistry' {
  interface WorkflowStepExtensionIdMap {
    'workflow-step.dependent-due': true;
  }
}

export const workflowStepDependentDueExtension: WorkflowStepExtensionDescriptor = {
  id: 'workflow-step.dependent-due',
  order: 30,
  mount: (context) => createElement(WorkflowDependentDue, { context }),
};

export {
  getWorkflowStepTiming,
  saveWorkflowStepTiming,
  type SaveWorkflowStepTimingInput,
} from './contract';
