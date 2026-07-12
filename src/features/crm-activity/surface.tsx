import { Clock3 } from 'lucide-react';
import { CrmActivitySurface } from './CrmActivitySurface';
import type { CrmHomeSurfaceDescriptor } from '@/features/crm-home/registry';

export const activitySurface: CrmHomeSurfaceDescriptor = {
  id: 'activity', label: 'Activity', icon: Clock3, route: 'activity', rail: true, Component: CrmActivitySurface,
};
export const timelineSurface: CrmHomeSurfaceDescriptor = { id: 'timeline', label: 'Timeline', icon: Clock3, route: 'timeline', rail: true, Component: CrmActivitySurface };
