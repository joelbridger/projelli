import { WorkflowAuthoringRuleMount } from './WorkflowAuthoringMount';

declare module '@/features/crm-workflows/workflowExtensionRegistry' {
  interface WorkflowRuleIdMap {
    'workflow-authoring.library': true;
  }
}

/** Mount metadata only; all authoring behavior stays inside this package. */
export const workflowAuthoringRuleDescriptor = {
  id: 'workflow-authoring.library',
  order: 20,
  mount: (context: { template: { id: string } }) => (
    <WorkflowAuthoringRuleMount templateId={context.template.id} />
  ),
} as const;
