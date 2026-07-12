import { Send } from 'lucide-react';
import type { CrmHomeSurfaceDescriptor } from '@/features/crm-home/registry';
import { CrmBroadcastSurface } from './BroadcastSurface';

export const emailBroadcastSurface: CrmHomeSurfaceDescriptor = {
  id: 'email-broadcast',
  label: 'Email broadcast',
  icon: Send,
  route: 'email-broadcast',
  rail: true,
  Component: CrmBroadcastSurface,
};
