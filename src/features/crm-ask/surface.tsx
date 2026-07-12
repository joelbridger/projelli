import { Search } from 'lucide-react';
import { CrmAskSurface } from './CrmAskSurface';
import type { CrmHomeSurfaceDescriptor } from '@/features/crm-home/registry';

export const crmAskSurface: CrmHomeSurfaceDescriptor = {
  id: 'search',
  label: 'Ask',
  icon: Search,
  route: 'search',
  rail: true,
  Component: CrmAskSurface,
};
