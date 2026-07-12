import { GitPullRequest, Workflow } from 'lucide-react';
import type { CrmHomeSurfaceDescriptor } from '@/features/crm-home/registry';
import { WorkflowsSurface } from './Workflows';
import { PropagationSurface } from './PropagationReview';

export const workflowsSurface: CrmHomeSurfaceDescriptor = {
  id: 'workflows', label: 'Workflows', icon: Workflow, route: 'workflows', rail: true, Component: WorkflowsSurface,
};
export const propagationSurface: CrmHomeSurfaceDescriptor = {
  id: 'propagation', label: 'Propagation review', icon: GitPullRequest, route: 'propagation', Component: PropagationSurface,
};
