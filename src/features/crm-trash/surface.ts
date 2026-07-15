import { Trash2 } from 'lucide-react';
import { TrashRecoverySurface } from './TrashRecoverySurface';
import type { CrmHomeSurfaceDescriptor } from '@/features/crm-home/registryTypes';

declare module '@/features/crm-home/registryTypes' {
  interface CrmHomeRouteMap {
    trash: true;
  }
}

export const trashSurface: CrmHomeSurfaceDescriptor = {
  id: 'trash',
  labelKey: 'crm.trash.title',
  icon: Trash2,
  route: 'trash',
  rail: { group: 'home', order: 260 },
  Component: TrashRecoverySurface,
};

