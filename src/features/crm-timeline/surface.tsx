import { Clock3 } from 'lucide-react';
import { CrmActivitySurface } from '@/features/crm-activity/CrmActivitySurface';
import type { CrmHomeSurfaceDescriptor } from '@/features/crm-home/registryTypes';

declare module '@/features/crm-home/registryTypes' {
  interface CrmHomeRouteMap {
    timeline: true;
  }
}

/**
 * The firm-wide Timeline uses the shared activity reader, but this feature
 * owns its Home entry so timeline routes do not leak back into Activity.
 */
export const timelineSurface: CrmHomeSurfaceDescriptor = {
  id: 'timeline',
  labelKey: 'crm.home.destinations.timeline',
  icon: Clock3,
  route: 'timeline',
  // Keep the old route working for saved links, but Activity is the one
  // visible destination for this shared screen.
  parentRoute: 'activity',
  Component: CrmActivitySurface,
};
