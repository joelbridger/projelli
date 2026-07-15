import { Inbox } from 'lucide-react';
import type { CrmHomeSurfaceDescriptor } from '@/features/crm-home/registryTypes';

declare module '@/features/crm-home/registryTypes' {
  interface CrmHomeRouteMap {
    'email-dropbox': true;
  }
}
import { EmailDropboxSurface } from './EmailDropboxSurface';

export const emailDropboxSurface: CrmHomeSurfaceDescriptor = {
  id: 'email-dropbox',
  labelKey: 'crm.home.destinations.email-dropbox',
  icon: Inbox,
  route: 'email-dropbox',
  rail: { group: 'home', order: 50 },
  Component: EmailDropboxSurface,
};
