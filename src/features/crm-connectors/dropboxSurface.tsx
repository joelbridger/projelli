import { Inbox } from 'lucide-react';
import type { CrmHomeSurfaceDescriptor } from '@/features/crm-home/registry';
import { EmailDropboxSurface } from './EmailDropboxSurface';

export const emailDropboxSurface: CrmHomeSurfaceDescriptor = {
  id: 'email-dropbox',
  label: 'Email dropbox',
  icon: Inbox,
  route: 'email-dropbox',
  rail: true,
  Component: EmailDropboxSurface,
};
