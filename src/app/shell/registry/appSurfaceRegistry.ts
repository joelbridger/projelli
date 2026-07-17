import {
  legacyAiAssistantSurface,
  legacyAskSurface,
  legacyAuditSurface,
  legacyClientsSurface,
  legacyDocumentsSurface,
  legacyEmailSurface,
  legacyHomeSurface,
  legacyPrivacySurface,
  legacyResearchSurface,
  legacySchedulingSurface,
  legacySettingsSurface,
  legacyTrashSurface,
  legacyWorkflowsSurface,
} from '@/app/shell/registry/legacyAppSurfaceDescriptors';
import type {
  AppSurfaceDescriptor,
  AppSurfaceId,
  AppSurfaceRegistration,
  AppSurfaceResolution,
} from '@/app/shell/registry/types';
import { isEnabled } from '@/platform/flags';

/**
 * The only shared mount list for top-level app surfaces. Existing entries are
 * append-only and never reordered during a feature wave.
 *
 * Future registration example (one line, no shared import):
 * () => import('@/features/meetings/appSurface').then((m) => m.meetingsSurface),
 */
export const appSurfaceRegistry: readonly AppSurfaceRegistration[] = [
  legacyHomeSurface,
  legacyClientsSurface,
  legacyAskSurface,
  legacySchedulingSurface,
  legacySettingsSurface,
  legacyDocumentsSurface,
  legacyEmailSurface,
  legacyWorkflowsSurface,
  legacyAuditSurface,
  legacyPrivacySurface,
  legacyAiAssistantSurface,
  legacyResearchSurface,
  legacyTrashSurface,
];

function isDescriptor(
  registration: AppSurfaceRegistration
): registration is AppSurfaceDescriptor {
  return typeof registration !== 'function';
}

export function validateAppSurfaceDescriptors(
  descriptors: readonly AppSurfaceDescriptor[]
): void {
  const ids = new Set<string>();
  const shortcuts = new Set<string>();

  for (const descriptor of descriptors) {
    if (ids.has(descriptor.id)) {
      throw new Error(
        `[appSurfaceRegistry] duplicate surface id: ${descriptor.id}`
      );
    }
    ids.add(descriptor.id);

    const namespace = descriptor.labelKey.split('.')[0];
    if (!namespace || namespace === descriptor.labelKey) {
      throw new Error(
        `[appSurfaceRegistry] labelKey must include a namespace: ${descriptor.id}`
      );
    }

    for (const shortcut of descriptor.shortcuts ?? []) {
      const normalized = shortcut.trim().toLowerCase();
      if (shortcuts.has(normalized)) {
        throw new Error(`[appSurfaceRegistry] duplicate shortcut: ${shortcut}`);
      }
      shortcuts.add(normalized);
    }
  }
}

// Keep the complete known table separate from the available projection. The
// distinction is what lets navigation tell a disabled known surface apart
// from an unknown id.
let resolvedDescriptors = appSurfaceRegistry.filter(isDescriptor);
validateAppSurfaceDescriptors(resolvedDescriptors);

let resolution: Promise<readonly AppSurfaceDescriptor[]> | null = null;

export function hasLazyAppSurfaceRegistrations(): boolean {
  return resolvedDescriptors.length !== appSurfaceRegistry.length;
}

function isAvailable(descriptor: AppSurfaceDescriptor): boolean {
  return !descriptor.availabilityFlag || isEnabled(descriptor.availabilityFlag);
}

export function getAvailableAppSurfaceDescriptors(
  descriptors: readonly AppSurfaceDescriptor[] = resolvedDescriptors
): readonly AppSurfaceDescriptor[] {
  return descriptors.filter(isAvailable);
}

export function getAppSurfaceDescriptors(): readonly AppSurfaceDescriptor[] {
  return getAvailableAppSurfaceDescriptors();
}

export function getAppSurfaceDescriptor(
  id: AppSurfaceId
): AppSurfaceDescriptor | undefined {
  return getAppSurfaceDescriptors().find((descriptor) => descriptor.id === id);
}

/**
 * Resolve one surface without collapsing disabled registered descriptors into
 * the same result as unregistered ids. Callers that can navigate must branch
 * on all three statuses instead of treating this as a truthy lookup.
 */
export function resolveAppSurfaceDescriptor(
  id: string,
  descriptors: readonly AppSurfaceDescriptor[] = resolvedDescriptors
): AppSurfaceResolution {
  const descriptor = descriptors.find((candidate) => candidate.id === id);
  if (!descriptor) return { status: 'unknown' };
  if (!isAvailable(descriptor)) {
    return { status: 'known-but-unavailable', descriptor };
  }
  return { status: 'resolved', descriptor };
}

export function resolveAppSurfaceRegistry(): Promise<
  readonly AppSurfaceDescriptor[]
> {
  if (!hasLazyAppSurfaceRegistrations()) {
    return Promise.resolve(getAppSurfaceDescriptors());
  }
  resolution ??= Promise.all(
    appSurfaceRegistry.map(async (registration) =>
      isDescriptor(registration) ? registration : await registration()
    )
  ).then((descriptors) => {
    validateAppSurfaceDescriptors(descriptors);
    resolvedDescriptors = descriptors;
    return getAppSurfaceDescriptors();
  });
  return resolution;
}

export function getOrderedAppSurfaces(
  placement: AppSurfaceDescriptor['placement'],
  descriptors: readonly AppSurfaceDescriptor[] = getAppSurfaceDescriptors()
): readonly AppSurfaceDescriptor[] {
  return descriptors
    .filter((descriptor) => descriptor.placement === placement)
    .slice()
    .sort((a, b) => a.order - b.order);
}

export const SAFE_APP_SURFACE_ID: AppSurfaceId = 'home';
