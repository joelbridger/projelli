import { createElement } from 'react';
import { isEnabled as isFlagEnabled } from '@/platform/flags/router';
import type { SchedulingSurfaceDescriptor } from '@/platform/calendar';
import { CalendarGridSurface } from './CalendarGridSurface';

declare module '@/platform/calendar' {
  interface SchedulingSurfaceMap {
    'calendar-grid': true;
  }
}

/** The registry guard prevents even a descriptor child from mounting while dark. */
export const calendarGridSchedulingSurface: SchedulingSurfaceDescriptor = {
  id: 'calendar-grid',
  slot: 'calendar-grid',
  order: 20,
  mount: () => isFlagEnabled('calendar-grid') ? createElement(CalendarGridSurface) : null,
};
