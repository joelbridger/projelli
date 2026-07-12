import { ListFilter } from 'lucide-react';
import { CrmViewsSurface } from './CrmViewsSurface';
import type { CrmHomeSurfaceDescriptor } from '@/features/crm-home/registry';

export const viewsSurface: CrmHomeSurfaceDescriptor = {
  id: 'views',
  label: 'Saved views',
  icon: ListFilter,
  route: 'views',
  rail: true,
  Component: CrmViewsSurface,
};
