import { createElement, type ReactNode } from 'react';
import type { SchedulingSurfaceDescriptor, SchedulingSurfaceRuntime } from '@/platform/calendar';
import { calendarGridSchedulingSurface } from '@/features/calendar-grid';
import { legacySchedulingSurface } from './schedulingSurfaceCompatibility';

/**
 * The append-only mount list for calendar and booking contributions. Descriptors
 * contain metadata and mount functions only; screen logic stays with its feature.
 */
export const schedulingSurfaceRegistry: readonly SchedulingSurfaceDescriptor[] = [
  legacySchedulingSurface,
  calendarGridSchedulingSurface,
];

export function validateSchedulingSurfaceDescriptors(
  descriptors: readonly SchedulingSurfaceDescriptor[],
): void {
  const ids = new Set<string>();
  for (const descriptor of descriptors) {
    if (!descriptor.id.trim()) throw new Error('[schedulingSurfaceRegistry] descriptor id is required');
    if (ids.has(descriptor.id)) throw new Error(`[schedulingSurfaceRegistry] duplicate surface id: ${descriptor.id}`);
    if (!Number.isFinite(descriptor.order)) throw new Error(`[schedulingSurfaceRegistry] invalid order: ${descriptor.id}`);
    if (descriptor.isEnabled !== undefined && typeof descriptor.isEnabled !== 'function') {
      throw new Error(`[schedulingSurfaceRegistry] isEnabled must be a function: ${descriptor.id}`);
    }
    if (typeof descriptor.mount !== 'function') throw new Error(`[schedulingSurfaceRegistry] mount is required: ${descriptor.id}`);
    ids.add(descriptor.id);
  }
}

export function renderSchedulingSurfaceRegistry(
  runtime: SchedulingSurfaceRuntime,
  descriptors = schedulingSurfaceRegistry,
): ReactNode {
  validateSchedulingSurfaceDescriptors(descriptors);
  return descriptors
    .slice()
    .sort((a, b) => a.order - b.order)
    .filter((descriptor) => descriptor.isEnabled?.() ?? true)
    .map((descriptor) => createElement('div', { key: descriptor.id, 'data-scheduling-surface-id': descriptor.id }, descriptor.mount(runtime)));
}
