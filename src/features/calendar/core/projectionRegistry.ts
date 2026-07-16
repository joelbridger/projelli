import type { CalendarOccurrence, CalendarRange, CalendarReadProjection } from './types';
import type { CalendarProjectionMap } from '../index';
import { validateCalendarRange } from './time';

export type CalendarProjectionId = Extract<keyof CalendarProjectionMap, string>;

export interface CalendarProjectionRuntime {
  readonly range: CalendarRange;
  readonly localOccurrences: readonly CalendarOccurrence[];
}

/** Read-only by construction: there is no save, update, delete, move, or credential method. */
export interface CalendarProjectionDescriptor<Id extends string = CalendarProjectionId> {
  readonly id: Id;
  readonly order: number;
  readonly source: 'local' | 'external-read-only';
  isEnabled(): boolean;
  load(runtime: CalendarProjectionRuntime): Promise<readonly CalendarReadProjection[]>;
}

export const canonicalLocalCalendarProjection: CalendarProjectionDescriptor<'canonical-local'> = {
  id: 'canonical-local',
  order: 100,
  source: 'local',
  isEnabled: () => true,
  load: (runtime) => Promise.resolve(runtime.localOccurrences.map((item) => ({
    occurrenceKey: item.occurrenceKey,
    source: 'local',
    sourceEventId: item.sourceEventId,
    calendarId: item.calendarId,
    title: item.title,
    startUtc: item.startUtc,
    endUtc: item.endUtc,
    allDay: item.allDay,
    status: item.status,
  }))),
};

/** Append descriptors in increasing order. Existing lines and order stay fixed. */
export const calendarProjectionRegistry: readonly CalendarProjectionDescriptor[] = [
  canonicalLocalCalendarProjection,
];

export function validateCalendarProjectionDescriptors(
  descriptors: readonly CalendarProjectionDescriptor[],
): void {
  const ids = new Set<string>();
  let previousOrder = Number.NEGATIVE_INFINITY;
  for (const descriptor of descriptors) {
    if (!descriptor.id.trim() || descriptor.id !== descriptor.id.trim()) {
      throw new Error('[calendarProjectionRegistry] descriptor ID is invalid');
    }
    if (ids.has(descriptor.id)) throw new Error(`[calendarProjectionRegistry] duplicate descriptor: ${descriptor.id}`);
    if (!Number.isInteger(descriptor.order) || descriptor.order <= previousOrder) {
      throw new Error(`[calendarProjectionRegistry] descriptors must remain in increasing order: ${descriptor.id}`);
    }
    const source: unknown = descriptor.source;
    if (source !== 'local' && source !== 'external-read-only') {
      throw new Error(`[calendarProjectionRegistry] descriptor source is invalid: ${descriptor.id}`);
    }
    if (typeof descriptor.isEnabled !== 'function' || typeof descriptor.load !== 'function') {
      throw new Error(`[calendarProjectionRegistry] descriptor functions are required: ${descriptor.id}`);
    }
    ids.add(descriptor.id);
    previousOrder = descriptor.order;
  }
}

export async function composeCalendarReadProjections(
  runtime: CalendarProjectionRuntime,
  descriptors: readonly CalendarProjectionDescriptor[] = calendarProjectionRegistry,
): Promise<readonly CalendarReadProjection[]> {
  validateCalendarRange(runtime.range);
  validateCalendarProjectionDescriptors(descriptors);
  const enabled = descriptors.filter((descriptor) => descriptor.isEnabled());
  const batches = await Promise.all(enabled.map((descriptor) => descriptor.load(runtime)));
  return batches.flat().sort((left, right) =>
    left.startUtc.localeCompare(right.startUtc) || left.occurrenceKey.localeCompare(right.occurrenceKey),
  );
}
