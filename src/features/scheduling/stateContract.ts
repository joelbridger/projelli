import type { SchedulingStateContract } from '@/platform/calendar';

/** Public state seam for scheduling mounts. Keep it stable as features grow. */
export type { SchedulingStateContract } from '@/platform/calendar';
export type SchedulingStoreState = SchedulingStateContract & {
  getDefaultAvailabilityRule(): SchedulingStateContract['availabilityRule'];
};
