import { createElement } from 'react';
import type { SchedulingSurfaceDescriptor } from '@/platform/calendar';
import { isEnabled } from '@/platform/flags';
import { CalendarAddEventMount } from './CalendarAddEventMount';

declare module '@/platform/calendar' {
  interface SchedulingSurfaceMap {
    'calendar-add-event': true;
  }
}

/** Standalone editor contribution; the shared scheduling shell remains feature-agnostic. */
export const calendarAddEventSurface: SchedulingSurfaceDescriptor = {
  id: 'calendar-add-event',
  slot: 'event-editor',
  order: 20,
  mount: () => createElement(CalendarAddEventMount),
};

/** The host receives no descriptor while the feature is dark. */
export const calendarAddEventSurfaces: readonly SchedulingSurfaceDescriptor[] =
  isEnabled('calendar-add-event') ? [calendarAddEventSurface] : [];
