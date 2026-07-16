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
} from '@/app/shell/registry/types';

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
  () => import('@/features/crm-shell').then((module) => module.crmShellSurface),
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

let resolvedDescriptors = appSurfaceRegistry.filter(isDescriptor);
validateAppSurfaceDescriptors(resolvedDescriptors);

let resolution: Promise<readonly AppSurfaceDescriptor[]> | null = null;

export function hasLazyAppSurfaceRegistrations(): boolean {
  return resolvedDescriptors.length !== appSurfaceRegistry.length;
}

export function getAppSurfaceDescriptors(): readonly AppSurfaceDescriptor[] {
  return resolvedDescriptors;
}

export function getAppSurfaceDescriptor(
  id: AppSurfaceId
): AppSurfaceDescriptor | undefined {
  return resolvedDescriptors.find((descriptor) => descriptor.id === id);
}

export function resolveAppSurfaceRegistry(): Promise<
  readonly AppSurfaceDescriptor[]
> {
  if (!hasLazyAppSurfaceRegistrations()) {
    return Promise.resolve(resolvedDescriptors);
  }
  resolution ??= Promise.all(
    appSurfaceRegistry.map(async (registration) =>
      isDescriptor(registration) ? registration : await registration()
    )
  ).then((descriptors) => {
    validateAppSurfaceDescriptors(descriptors);
    resolvedDescriptors = descriptors;
    return resolvedDescriptors;
  });
  return resolution;
}

export function getOrderedAppSurfaces(
  placement: AppSurfaceDescriptor['placement'],
  descriptors: readonly AppSurfaceDescriptor[] = resolvedDescriptors
): readonly AppSurfaceDescriptor[] {
  return descriptors
    .filter((descriptor) => descriptor.placement === placement)
    .slice()
    .sort((a, b) => a.order - b.order);
}

export const SAFE_APP_SURFACE_ID: AppSurfaceId = 'home';
