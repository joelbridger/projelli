import { Send } from 'lucide-react';
import type { CrmHomeSurfaceDescriptor } from '@/features/crm-home/registryTypes';

declare module '@/features/crm-home/registryTypes' {
  interface CrmHomeRouteMap {
    'email-broadcast': true;
  }
}
import { CrmBroadcastSurface } from './BroadcastSurface';

export const emailBroadcastSurface: CrmHomeSurfaceDescriptor = {
  id: 'email-broadcast',
  labelKey: 'crm.home.destinations.email-broadcast',
  icon: Send,
  route: 'email-broadcast',
  rail: { group: 'home', order: 30 },
  Component: CrmBroadcastSurface,
};
