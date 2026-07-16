import type { WorkflowRuleDescriptor } from '@/features/crm-workflows/workflowExtensionRegistry';
import { WorkflowAuthoringRuleMount } from './WorkflowAuthoringMount';

declare module '@/features/crm-workflows/workflowExtensionRegistry' {
  interface WorkflowRuleIdMap {
    'workflow-authoring.library': true;
  }
}

/** Mount metadata only; all authoring behavior stays inside this package. */
export const workflowAuthoringRuleDescriptor: WorkflowRuleDescriptor = {
  id: 'workflow-authoring.library',
  order: 20,
  mount: (context) => <WorkflowAuthoringRuleMount context={context} />,
};
