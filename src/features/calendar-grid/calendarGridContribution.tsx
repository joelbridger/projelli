import { createElement } from 'react';
import { isEnabled as isFlagEnabled } from '@/platform/flags/router';
import type { SchedulingSurfaceDescriptor } from '@/platform/calendar';
import { CalendarGridSurface } from './CalendarGridSurface';
import {
  defaultCalendarGridViewComposition,
  type CalendarGridViewComposition,
} from './calendarGridViewRegistry';

declare module '@/platform/calendar' {
  interface SchedulingSurfaceMap {
    'calendar-grid': true;
  }
}

/** Builds the top-level mount while allowing the composition root to add public grid views. */
export function createCalendarGridSchedulingSurface(
  viewComposition: CalendarGridViewComposition = defaultCalendarGridViewComposition,
): SchedulingSurfaceDescriptor {
  return {
    id: 'calendar-grid',
    slot: 'calendar-grid',
    order: 20,
    isEnabled: () => isFlagEnabled('calendar-grid'),
    mount: () => createElement(CalendarGridSurface, { viewComposition }),
  };
}

/** The registry guard prevents even a descriptor wrapper from existing while dark. */
export const calendarGridSchedulingSurface = createCalendarGridSchedulingSurface();
