import { Clock3 } from 'lucide-react';
import type { CrmHomeSurfaceDescriptor } from '@/features/crm-home/registryTypes';
import { TeamActivitySurface } from './TeamActivitySurface';

/** Replaces the legacy descriptor in the one CRM Home registry entry. */
export const teamActivitySurface: CrmHomeSurfaceDescriptor = {
  id: 'activity',
  labelKey: 'crm.home.destinations.activity',
  icon: Clock3,
  route: 'activity',
  rail: { group: 'home', order: 10 },
  Component: TeamActivitySurface,
};
