import { LayoutDashboard } from 'lucide-react';
import type { CrmHomeSurfaceDescriptor } from '@/features/crm-home/registry';
import { TodaySurface } from './Today';

export const todaySurface: CrmHomeSurfaceDescriptor = {
  id: 'today', label: 'Today', icon: LayoutDashboard, route: 'today', rail: true, Component: TodaySurface,
};
