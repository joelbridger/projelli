import { CalendarDays, Mail } from 'lucide-react';
import type { CrmHomeSurfaceDescriptor } from '@/features/crm-home/registry';
import { CrmCalendarSurface, CrmEmailSurface } from './CrmConnectorSurfaces';

export const calendarSurface: CrmHomeSurfaceDescriptor = {
  id: 'calendar',
  label: 'Calendar',
  icon: CalendarDays,
  route: 'calendar',
  rail: true,
  Component: CrmCalendarSurface,
};
export const emailSurface: CrmHomeSurfaceDescriptor = {
  id: 'email',
  label: 'Email',
  icon: Mail,
  route: 'email',
  rail: true,
  Component: CrmEmailSurface,
};
