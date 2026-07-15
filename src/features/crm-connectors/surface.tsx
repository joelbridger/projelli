import { CalendarDays, Mail } from 'lucide-react';
import type { CrmHomeSurfaceDescriptor } from '@/features/crm-home/registryTypes';

declare module '@/features/crm-home/registryTypes' {
  interface CrmHomeRouteMap {
    calendar: true;
    email: true;
  }
}
import { CrmCalendarSurface, CrmEmailSurface } from './CrmConnectorSurfaces';

export const calendarSurface: CrmHomeSurfaceDescriptor = {
  id: 'calendar',
  labelKey: 'crm.home.destinations.calendar',
  icon: CalendarDays,
  route: 'calendar',
  rail: { group: 'home', order: 20 },
  Component: CrmCalendarSurface,
};
export const emailSurface: CrmHomeSurfaceDescriptor = {
  id: 'email',
  labelKey: 'crm.home.destinations.email',
  icon: Mail,
  route: 'email',
  rail: { group: 'home', order: 40 },
  Component: CrmEmailSurface,
};
