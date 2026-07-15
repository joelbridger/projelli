import { ClipboardList } from 'lucide-react';
import type { CrmHomeSurfaceDescriptor } from '@/features/crm-home/registryTypes';
import { InternalProjectsSurface } from './InternalProjectsSurface';

declare module '@/features/crm-home/registryTypes' {
  interface CrmHomeRouteMap {
    'internal-projects': true;
  }
}

export const internalProjectsSurface: CrmHomeSurfaceDescriptor = {
  id: 'internal-projects',
  labelKey: 'internal-projects.nav',
  icon: ClipboardList,
  route: 'internal-projects',
  rail: { group: 'work', order: 50 },
  flagId: 'internal-projects',
  Component: InternalProjectsSurface,
};
