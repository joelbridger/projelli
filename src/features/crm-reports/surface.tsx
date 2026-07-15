import { BarChart3 } from 'lucide-react';
import { Reports } from './Reports';
import type { CrmHomeSurfaceDescriptor } from '@/features/crm-home/registryTypes';

declare module '@/features/crm-home/registryTypes' {
  interface CrmHomeRouteMap {
    reports: true;
  }
}

export const reportsSurface: CrmHomeSurfaceDescriptor = {
  id: 'reports',
  labelKey: 'crm.home.destinations.reports',
  icon: BarChart3,
  route: 'reports',
  rail: { group: 'home', order: 180 },
  shortcut: 'r',
  Component: Reports,
};
