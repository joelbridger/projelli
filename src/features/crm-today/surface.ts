import { LayoutDashboard } from 'lucide-react';
import type { CrmHomeSurfaceDescriptor } from '@/features/crm-home/registryTypes';

declare module '@/features/crm-home/registryTypes' {
  interface CrmHomeRouteMap {
    today: true;
  }
}
import { TodaySurface } from './Today';

export const todaySurface: CrmHomeSurfaceDescriptor = {
  id: 'today',
  labelKey: 'crm.home.destinations.today',
  icon: LayoutDashboard,
  route: 'today',
  rail: { group: 'home', order: 220 },
  shortcut: 'h',
  Component: TodaySurface,
};
