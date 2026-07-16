/** Public feature doorway for every calendar-family dependent. */
export * from './core';

import type { CalendarProjectionDescriptor } from './core';

/** Projection lanes augment this map through `@/features/calendar` only. */
export interface CalendarProjectionMap {
  'canonical-local': CalendarProjectionDescriptor<'canonical-local'>;
}
