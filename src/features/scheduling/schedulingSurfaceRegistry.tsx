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
  let calendarSurfaceCount = 0;
  for (const descriptor of descriptors) {
    if (!descriptor.id.trim()) throw new Error('[schedulingSurfaceRegistry] descriptor id is required');
    if (ids.has(descriptor.id)) throw new Error(`[schedulingSurfaceRegistry] duplicate surface id: ${descriptor.id}`);
    if (!Number.isFinite(descriptor.order)) throw new Error(`[schedulingSurfaceRegistry] invalid order: ${descriptor.id}`);
    if (descriptor.isEnabled !== undefined && typeof descriptor.isEnabled !== 'function') {
      throw new Error(`[schedulingSurfaceRegistry] isEnabled must be a function: ${descriptor.id}`);
    }
    if (typeof descriptor.mount !== 'function') throw new Error(`[schedulingSurfaceRegistry] mount is required: ${descriptor.id}`);
    if (descriptor.slot === 'calendar-grid') calendarSurfaceCount += 1;
    ids.add(descriptor.id);
  }
  if (calendarSurfaceCount > 1) {
    throw new Error('[schedulingSurfaceRegistry] only one calendar surface may be registered');
  }
}

export function renderSchedulingSurfaceRegistry(
  runtime: SchedulingSurfaceRuntime,
  descriptors = schedulingSurfaceRegistry,
): ReactNode {
  validateSchedulingSurfaceDescriptors(descriptors);
  const enabled = descriptors
    .slice()
    .sort((a, b) => a.order - b.order)
    .filter((descriptor) => descriptor.isEnabled?.() ?? true);
  // Calendar temporarily takes over this existing work area until Meetings is
  // mounted. It must never become a narrow dashboard card beside booking setup.
  const calendarWorkspaceIsActive = enabled.some((descriptor) => descriptor.id === 'calendar-grid');
  return enabled
    .filter((descriptor) => !calendarWorkspaceIsActive || descriptor.id !== 'legacy-scheduling')
    .map((descriptor) => createElement('div', { key: descriptor.id, 'data-scheduling-surface-id': descriptor.id }, descriptor.mount(runtime)));
}
