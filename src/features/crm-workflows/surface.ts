import { FolderKanban, GitPullRequest, Workflow } from 'lucide-react';
import type { CrmHomeSurfaceDescriptor } from '@/features/crm-home/registryTypes';

declare module '@/features/crm-home/registryTypes' {
  interface CrmHomeRouteMap {
    workflows: true;
    propagation: true;
    projects: true;
  }
}
import { WorkflowsSurface } from './Workflows';
import { PropagationSurface } from './PropagationReview';
import { ProjectsSurface } from './Projects';

export const workflowsSurface: CrmHomeSurfaceDescriptor = {
  id: 'workflows',
  labelKey: 'crm.home.destinations.workflows',
  icon: Workflow,
  route: 'workflows',
  rail: { group: 'home', order: 250 },
  shortcut: 'w',
  Component: WorkflowsSurface,
};
export const propagationSurface: CrmHomeSurfaceDescriptor = {
  id: 'propagation',
  labelKey: 'crm.home.destinations.propagation',
  icon: GitPullRequest,
  route: 'propagation',
  parentRoute: 'workflows',
  Component: PropagationSurface,
};
export const projectsSurface: CrmHomeSurfaceDescriptor = {
  id: 'projects',
  labelKey: 'crm.home.destinations.projects',
  icon: FolderKanban,
  route: 'projects',
  rail: { group: 'home', order: 170 },
  Component: ProjectsSurface,
};
