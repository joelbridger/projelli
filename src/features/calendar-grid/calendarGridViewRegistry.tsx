import type { ReactNode } from 'react';
import type { CalendarOccurrence, CalendarRange } from '@/features/calendar';
import {
  CalendarDayLayout,
  CalendarMonthLayout,
  CalendarWeekLayout,
} from './calendarGridLayouts';
import type { CalendarGridView } from './calendarGridRange';

/** Feature modules augment this map beside their own grid-view descriptor. */
export interface CalendarGridViewMap {
  month: true;
  week: true;
  day: true;
}

export type CalendarGridViewId = Extract<keyof CalendarGridViewMap, string>;

/** The bounded, read-only projection shared by every presentation in the host. */
export interface CalendarGridViewContext {
  readonly range: CalendarRange;
  readonly occurrences: readonly CalendarOccurrence[];
  readonly selectedOccurrenceKey: string | null;
  readonly onSelectOccurrence: (occurrenceKey: string) => void;
}

export interface CalendarGridViewDescriptor<
  Id extends CalendarGridViewId = CalendarGridViewId,
> {
  readonly id: Id;
  readonly order: number;
  readonly labelKey: string;
  /** Native calendar layouts change the query range. Additive presentations keep it. */
  readonly rangeView?: CalendarGridView;
  readonly isEnabled?: () => boolean;
  readonly mount: (context: CalendarGridViewContext) => ReactNode;
}

export interface CalendarGridViewComposition {
  readonly views: readonly CalendarGridViewDescriptor[];
}

export function defineCalendarGridView<Id extends CalendarGridViewId>(
  descriptor: CalendarGridViewDescriptor<Id>,
): CalendarGridViewDescriptor<Id> {
  return descriptor;
}

const nativeCalendarGridViews: readonly CalendarGridViewDescriptor[] = [
  defineCalendarGridView({
    id: 'month',
    order: 10,
    labelKey: 'calendar-grid.views.month',
    rangeView: 'month',
    mount: (context) => <CalendarMonthLayout {...context} />,
  }),
  defineCalendarGridView({
    id: 'week',
    order: 20,
    labelKey: 'calendar-grid.views.week',
    rangeView: 'week',
    mount: (context) => <CalendarWeekLayout {...context} />,
  }),
  defineCalendarGridView({
    id: 'day',
    order: 30,
    labelKey: 'calendar-grid.views.day',
    rangeView: 'day',
    mount: (context) => <CalendarDayLayout {...context} />,
  }),
];

export function validateCalendarGridViewDescriptors(
  descriptors: readonly CalendarGridViewDescriptor[],
): void {
  const ids = new Set<string>();
  for (const descriptor of descriptors) {
    if (!descriptor.id.trim()) throw new Error('[calendarGridViewRegistry] descriptor id is required');
    if (ids.has(descriptor.id)) throw new Error(`[calendarGridViewRegistry] duplicate view id: ${descriptor.id}`);
    if (!Number.isFinite(descriptor.order)) throw new Error(`[calendarGridViewRegistry] invalid order: ${descriptor.id}`);
    if (!descriptor.labelKey.trim()) throw new Error(`[calendarGridViewRegistry] label key is required: ${descriptor.id}`);
    if (descriptor.isEnabled !== undefined && typeof descriptor.isEnabled !== 'function') {
      throw new Error(`[calendarGridViewRegistry] isEnabled must be a function: ${descriptor.id}`);
    }
    if (typeof descriptor.mount !== 'function') throw new Error(`[calendarGridViewRegistry] mount is required: ${descriptor.id}`);
    ids.add(descriptor.id);
  }
}

/** Builds an open-world host configuration without mutating the default list. */
export function createCalendarGridViewComposition(
  ...contributions: readonly CalendarGridViewDescriptor[]
): CalendarGridViewComposition {
  const views = [...nativeCalendarGridViews, ...contributions];
  validateCalendarGridViewDescriptors(views);
  return { views: views.slice().sort((left, right) => left.order - right.order) };
}

export const defaultCalendarGridViewComposition = createCalendarGridViewComposition();

export function getEnabledCalendarGridViews(
  composition: CalendarGridViewComposition = defaultCalendarGridViewComposition,
): readonly CalendarGridViewDescriptor[] {
  validateCalendarGridViewDescriptors(composition.views);
  return composition.views.filter((descriptor) => descriptor.isEnabled?.() ?? true);
}
