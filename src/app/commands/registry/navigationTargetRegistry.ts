import {
  getAppSurfaceDescriptors,
  resolveAppSurfaceRegistry,
} from '@/app/shell/registry/appSurfaceRegistry';
import type {
  AppSurfaceDescriptor,
  AppSurfaceId,
} from '@/app/shell/registry/types';
import type { MattersSurfaceMode } from '@/platform/state/appNavigationStore';
import type { AppSurface } from '@/platform/types/navigation';
import type { MatterUiSnapshot } from '@/platform/matter/matterUiStore';
import {
  legacyNavigationTargetDescriptors,
  restoreMatterSnapshotTarget,
} from '@/app/commands/registry/legacyNavigationTargetDescriptors';

export interface NavigationTargetSource {
  kind?: string;
  ref?: string;
  snippet?: string;
}

/** Payload carried by the existing matter-launch custom event. */
export interface MatterNavigationTarget {
  matterId: string;
  surface?: string;
  question?: string;
  source?: NavigationTargetSource;
}

export interface NavigationTargetRuntime {
  setSurface: (surface: AppSurface) => void;
  setDocumentsView: (view: 'browser' | 'editor') => void;
  setAskPrefill: (
    prefill: { question: string; autoSubmit: boolean } | null
  ) => void;
  setMattersSurfaceMode?: (mode: MattersSurfaceMode) => void;
  pushNavigationSnapshot?: () => void;
  registeredTargets?: readonly NavigationTargetDescriptor[];
}

/**
 * A feature-owned deep-link alias. `appSurfaceId` is always a real registered
 * shell destination, even when the external alias (for example `meetings`)
 * resolves into a client-hub sub-surface.
 */
export interface NavigationTargetDescriptor {
  id: string;
  appSurfaceId: AppSurfaceId;
  resolve: (
    target: MatterNavigationTarget,
    runtime: NavigationTargetRuntime
  ) => void | Promise<void>;
  restoreSnapshot?: (
    snapshot: MatterUiSnapshot,
    target: MatterNavigationTarget,
    runtime: NavigationTargetRuntime
  ) => void | Promise<void>;
}

export type NavigationTargetRegistration =
  | NavigationTargetDescriptor
  | (() => Promise<
      NavigationTargetDescriptor | readonly NavigationTargetDescriptor[]
    >);

/**
 * The only shared mount list for cross-tool navigation targets. Existing
 * aliases are append-only and never reordered during a feature wave.
 */
export const navigationTargetRegistry: readonly NavigationTargetRegistration[] =
  [...legacyNavigationTargetDescriptors];

function isDescriptor(
  registration: NavigationTargetRegistration
): registration is NavigationTargetDescriptor {
  return typeof registration !== 'function';
}

function isDescriptorResult(
  result: NavigationTargetDescriptor | readonly NavigationTargetDescriptor[]
): result is NavigationTargetDescriptor {
  return !Array.isArray(result);
}

export function validateNavigationTargetDescriptors(
  descriptors: readonly NavigationTargetDescriptor[],
  surfaces: readonly AppSurfaceDescriptor[] = getAppSurfaceDescriptors()
): void {
  const ids = new Set<string>();
  const surfaceIds = new Set(surfaces.map((surface) => surface.id));
  for (const descriptor of descriptors) {
    if (ids.has(descriptor.id)) {
      throw new Error(
        `[navigationTargetRegistry] duplicate target id: ${descriptor.id}`
      );
    }
    ids.add(descriptor.id);
    if (!surfaceIds.has(descriptor.appSurfaceId)) {
      throw new Error(
        `[navigationTargetRegistry] unknown app surface: ${descriptor.appSurfaceId}`
      );
    }
  }
}

let resolvedDescriptors = navigationTargetRegistry.filter(isDescriptor);
validateNavigationTargetDescriptors(resolvedDescriptors);

let resolution: Promise<readonly NavigationTargetDescriptor[]> | null = null;
let registryResolved = navigationTargetRegistry.every(isDescriptor);

export function hasLazyNavigationTargetRegistrations(): boolean {
  return !registryResolved;
}

export function getNavigationTargetDescriptors(): readonly NavigationTargetDescriptor[] {
  return resolvedDescriptors;
}

export function resolveNavigationTargetRegistry(): Promise<
  readonly NavigationTargetDescriptor[]
> {
  if (!hasLazyNavigationTargetRegistrations()) {
    return Promise.resolve(resolvedDescriptors);
  }
  resolution ??= Promise.all([
    resolveAppSurfaceRegistry(),
    Promise.all(
      navigationTargetRegistry.map(async (registration) => {
        const result = isDescriptor(registration)
          ? registration
          : await registration();
        return isDescriptorResult(result) ? [result] : result;
      })
    ),
  ]).then(([surfaces, groups]) => {
    const descriptors = groups.flat();
    validateNavigationTargetDescriptors(descriptors, surfaces);
    resolvedDescriptors = descriptors;
    registryResolved = true;
    return resolvedDescriptors;
  });
  return resolution;
}

function reportUnknownTarget(target: MatterNavigationTarget): void {
  if (!target.surface) return;
  console.warn(
    `[navigationTargetRegistry] unknown navigation target "${target.surface}"; using ${restoreMatterSnapshotTarget.id}`
  );
}

function resolveFromDescriptors(
  target: MatterNavigationTarget,
  runtime: NavigationTargetRuntime,
  descriptors: readonly NavigationTargetDescriptor[]
): void | Promise<void> {
  const descriptor = descriptors.find((item) => item.id === target.surface);
  if (descriptor) return descriptor.resolve(target, runtime);
  reportUnknownTarget(target);
  return restoreMatterSnapshotTarget.resolve(target, {
    ...runtime,
    registeredTargets: descriptors,
  });
}

/** Resolve a target synchronously when registered, loading lazy modules only on demand. */
export function resolveNavigationTarget(
  target: MatterNavigationTarget,
  runtime: NavigationTargetRuntime
): void | Promise<void> {
  const descriptor = resolvedDescriptors.find(
    (item) => item.id === target.surface
  );
  if (descriptor) return descriptor.resolve(target, runtime);
  if (!hasLazyNavigationTargetRegistrations()) {
    return resolveFromDescriptors(target, runtime, resolvedDescriptors);
  }
  return resolveNavigationTargetRegistry().then((descriptors) =>
    resolveFromDescriptors(target, runtime, descriptors)
  );
}
