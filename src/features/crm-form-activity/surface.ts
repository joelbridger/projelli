import { ClipboardCheck } from 'lucide-react';
import type { CrmHomeSurfaceDescriptor } from '@/features/crm-home/registryTypes';
import { FormActivitySurface } from './FormActivitySurface';

declare module '@/features/crm-home/registryTypes' {
  interface CrmHomeRouteMap {
    'form-activity': true;
  }
}

export const formActivitySurface: CrmHomeSurfaceDescriptor = {
  id: 'form-activity',
  labelKey: 'form-activity.title',
  icon: ClipboardCheck,
  route: 'form-activity',
  rail: { group: 'firm', order: 170 },
  shortcut: 'a',
  flagId: 'form-activity',
  Component: FormActivitySurface,
};
