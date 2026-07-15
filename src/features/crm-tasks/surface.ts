import { ClipboardList } from 'lucide-react';
import type { CrmHomeSurfaceDescriptor } from '@/features/crm-home/registryTypes';

declare module '@/features/crm-home/registryTypes' {
  interface CrmHomeRouteMap {
    tasks: true;
  }
}
import { TasksSurface } from './Tasks';

export const tasksSurface: CrmHomeSurfaceDescriptor = {
  id: 'tasks',
  labelKey: 'crm.home.destinations.tasks',
  icon: ClipboardList,
  route: 'tasks',
  rail: { group: 'home', order: 210 },
  shortcut: 't',
  Component: TasksSurface,
};
