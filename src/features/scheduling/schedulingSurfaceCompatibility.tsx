import { createElement } from 'react';
import type { SchedulingSurfaceDescriptor } from '@/platform/calendar';
import { LegacySchedulingSurface } from './SchedulingHome';

declare module '@/platform/calendar' {
  interface SchedulingSurfaceMap {
    'legacy-scheduling': true;
  }
}

/** Carries the existing scheduling page unchanged while later mounts move in. */
export const legacySchedulingSurface: SchedulingSurfaceDescriptor = {
  id: 'legacy-scheduling',
  slot: 'availability',
  order: 10,
  mount: () => createElement(LegacySchedulingSurface),
};
