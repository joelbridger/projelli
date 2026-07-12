import { ClipboardList, GitPullRequest, LayoutDashboard, Tags, Workflow } from 'lucide-react';
import { useCrmHomeSurfaceContext } from './surfaceContext';
import type { CrmHomeSurfaceDescriptor } from './registry';

function LegacySurface({ id }: { id: string }) {
  return <>{useCrmHomeSurfaceContext().renderLegacySurface(id)}</>;
}

export const todaySurface: CrmHomeSurfaceDescriptor = { id: 'today', label: 'Today', icon: LayoutDashboard, route: 'today', rail: true, Component: () => <LegacySurface id="today" /> };
export const tasksSurface: CrmHomeSurfaceDescriptor = { id: 'tasks', label: 'Tasks', icon: ClipboardList, route: 'tasks', rail: true, Component: () => <LegacySurface id="tasks" /> };
export const workflowsSurface: CrmHomeSurfaceDescriptor = { id: 'workflows', label: 'Workflows', icon: Workflow, route: 'workflows', rail: true, Component: () => <LegacySurface id="workflows" /> };
export const propagationSurface: CrmHomeSurfaceDescriptor = { id: 'propagation', label: 'Propagation review', icon: GitPullRequest, route: 'propagation', Component: () => <LegacySurface id="propagation" /> };
export const fieldsTagsSurface: CrmHomeSurfaceDescriptor = { id: 'fields-tags', label: 'Fields and tags', icon: Tags, route: 'fields-tags', Component: () => <LegacySurface id="fields-tags" /> };
export const intakeLinksSurface: CrmHomeSurfaceDescriptor = { id: 'intake-links', label: 'Intake links', icon: ClipboardList, route: 'intake-links', Component: () => <LegacySurface id="intake-links" /> };
