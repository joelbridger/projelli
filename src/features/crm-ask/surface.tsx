import { Search } from 'lucide-react';
import { CrmAskSurface } from './CrmAskSurface';
import type { CrmHomeSurfaceDescriptor } from '@/features/crm-home/registryTypes';

export const crmAskSurface: CrmHomeSurfaceDescriptor = {
  id: 'search',
  labelKey: 'crm.home.destinations.ask',
  icon: Search,
  route: 'search',
  rail: { group: 'home', order: 190 },
  Component: CrmAskSurface,
};
