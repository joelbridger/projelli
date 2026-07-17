import {
  getKnownAppSurfaceDescriptors,
  hasLazyAppSurfaceRegistrations,
  resolveAppSurfaceRegistry,
} from '@/app/shell/registry/appSurfaceRegistry';
import type { AppSurfaceId } from '@/app/shell/registry/types';
import type { MattersSurfaceMode } from '@/platform/state/appNavigationStore';
import type { AppSurface } from '@/platform/types/navigation';
import { legacyNavigationTargetDescriptors } from '@/app/commands/registry/legacyNavigationTargetDescriptors';

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
}

/**
 * The event-bus-to-router handoff. The event bus carries the raw request to
 * this app-owned route; only AppSurfaceRouter turns it into navigation.
 */
export const NAVIGATION_TARGET_DISPATCH_EVENT =
  'lantern:navigation-target-dispatch';

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
  descriptors: readonly NavigationTargetDescriptor[]
): void {
  const ids = new Set<string>();
  // A static alias may legitimately point at a lazy app-surface registration.
  // Its id is not knowable until that registration resolves, so defer only the
  // cross-registry check; duplicates still fail immediately below.
  const surfaceIds = new Set(
    getKnownAppSurfaceDescriptors().map((surface) => surface.id)
  );
  const canValidateSurfaceIds = !hasLazyAppSurfaceRegistrations();
  for (const descriptor of descriptors) {
    if (ids.has(descriptor.id)) {
      throw new Error(
        `[navigationTargetRegistry] duplicate target id: ${descriptor.id}`
      );
    }
    ids.add(descriptor.id);
    if (canValidateSurfaceIds && !surfaceIds.has(descriptor.appSurfaceId)) {
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
  if (
    !hasLazyNavigationTargetRegistrations() &&
    !hasLazyAppSurfaceRegistrations()
  ) {
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
  ]).then(([, groups]) => {
    const descriptors = groups.flat();
    validateNavigationTargetDescriptors(descriptors);
    resolvedDescriptors = descriptors;
    registryResolved = true;
    return resolvedDescriptors;
  });
  return resolution;
}

function findNavigationTargetDescriptor(
  target: MatterNavigationTarget,
  descriptors: readonly NavigationTargetDescriptor[]
): NavigationTargetDescriptor | undefined {
  return descriptors.find((item) => item.id === target.surface);
}

/**
 * Resolve only the declared alias. AppSurfaceRouter owns the next step: it
 * checks the registered surface, supplies its existing runtime, and chooses
 * either that surface's resolver or the preserved legacy route.
 */
export function resolveNavigationTargetDescriptor(
  target: MatterNavigationTarget
):
  | NavigationTargetDescriptor
  | undefined
  | Promise<NavigationTargetDescriptor | undefined> {
  const descriptor = findNavigationTargetDescriptor(
    target,
    resolvedDescriptors
  );
  // An eager alias can still point at a lazy app surface. Wait for that
  // registry too, so routing does not mistake a still-loading known surface
  // for an unavailable one.
  if (descriptor && !hasLazyAppSurfaceRegistrations()) return descriptor;
  if (
    !hasLazyNavigationTargetRegistrations() &&
    !hasLazyAppSurfaceRegistrations()
  ) {
    return undefined;
  }
  return resolveNavigationTargetRegistry().then((descriptors) =>
    findNavigationTargetDescriptor(target, descriptors)
  );
}

/** Forward a validated raw event-bus request to the router without interpreting it. */
export function dispatchNavigationTarget(target: MatterNavigationTarget): void {
  window.dispatchEvent(
    new CustomEvent<MatterNavigationTarget>(NAVIGATION_TARGET_DISPATCH_EVENT, {
      detail: target,
    })
  );
}
