import { Clock3 } from 'lucide-react';
import { CrmActivitySurface } from '@/features/crm-activity/CrmActivitySurface';
import type { CrmHomeSurfaceDescriptor } from '@/features/crm-home/registry';

/**
 * The firm-wide Timeline uses the shared activity reader, but this feature
 * owns its Home entry so timeline routes do not leak back into Activity.
 */
export const timelineSurface: CrmHomeSurfaceDescriptor = {
  id: 'timeline',
  label: 'Timeline',
  icon: Clock3,
  route: 'timeline',
  rail: true,
  Component: CrmActivitySurface,
};
