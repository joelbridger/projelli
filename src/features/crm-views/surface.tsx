import { ListFilter } from 'lucide-react';
import { CrmViewsSurface } from './CrmViewsSurface';
import type { CrmHomeSurfaceDescriptor } from '@/features/crm-home/registryTypes';

declare module '@/features/crm-home/registryTypes' {
  interface CrmHomeRouteMap {
    views: true;
  }
}

export const viewsSurface: CrmHomeSurfaceDescriptor = {
  id: 'views',
  labelKey: 'crm.home.destinations.views',
  icon: ListFilter,
  route: 'views',
  rail: { group: 'home', order: 230 },
  Component: CrmViewsSurface,
};
