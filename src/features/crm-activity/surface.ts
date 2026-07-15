import { Clock3 } from 'lucide-react';
import { CrmActivitySurface } from './CrmActivitySurface';
import type { CrmHomeSurfaceDescriptor } from '@/features/crm-home/registryTypes';

declare module '@/features/crm-home/registryTypes' {
  interface CrmHomeRouteMap {
    activity: true;
  }
}

export const activitySurface: CrmHomeSurfaceDescriptor = {
  id: 'activity',
  labelKey: 'crm.home.destinations.activity',
  icon: Clock3,
  route: 'activity',
  rail: { group: 'home', order: 10 },
  Component: CrmActivitySurface,
};
