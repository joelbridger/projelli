import { Search } from 'lucide-react';
import { CrmSearchSurface } from './CrmSearchSurface';
import type { CrmHomeSurfaceDescriptor } from '@/features/crm-home/registryTypes';

declare module '@/features/crm-home/registryTypes' {
  interface CrmHomeRouteMap {
    search: true;
  }
}

export const searchSurface: CrmHomeSurfaceDescriptor = {
  id: 'search',
  labelKey: 'crm.home.destinations.search',
  icon: Search,
  route: 'search',
  rail: { group: 'home', order: 200 },
  Component: CrmSearchSurface,
};
