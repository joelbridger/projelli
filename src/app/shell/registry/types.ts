import type { ComponentType, ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import type { AppSurface, NavigationTarget } from '@/platform/types/navigation';
import type { AppSurfaceRuntime } from '@/app/shell/runtime/AppSurfaceRuntime';
import type { FlagId } from '@/platform/flags';

export type AppSurfaceId = AppSurface;
export type AppSurfacePlacement = 'primary' | 'utility' | 'hidden';
export type AppSurfaceClientContext = 'shared' | 'firm' | 'preserve-hidden';

export interface AppSurfaceComponentProps {
  runtime: AppSurfaceRuntime;
}

export type AppSurfaceComponent = ComponentType<AppSurfaceComponentProps>;

export interface AppSurfaceCommandDescriptor {
  id: string;
  labelKey: string;
  shortcut?: string;
}

/**
 * One source of truth for a top-level surface's mount and shell metadata.
 *
 * `render` owns mounting and any lazy-loading behavior. Registry consumers
 * must not expect a separate loader hook.
 *
 * `legacyLabel` takes precedence over `labelKey` only for labels carried over
 * unchanged during the shell refactor. New surfaces should use `labelKey`
 * alone, and every key must still exist even when a legacy label masks it.
 *
 * `availabilityFlag` is the registry-owned availability decision for a whole
 * surface. A disabled flag keeps the descriptor known to routing, while
 * removing it from the available surface list. Do not also flag-gate that
 * same surface at an ad-hoc shell mount: the registry is the single decision
 * point for top-level surface availability.
 */
export interface AppSurfaceDescriptor {
  id: AppSurfaceId;
  labelKey: string;
  legacyLabel?: string;
  icon: LucideIcon;
  placement: AppSurfacePlacement;
  order: number;
  clientContext: AppSurfaceClientContext;
  errorLabel: string;
  render: (runtime: AppSurfaceRuntime) => ReactNode;
  parentRoute?: AppSurfaceId;
  shortcuts?: readonly string[];
  resolveNavigation?: (
    target: NavigationTarget,
    runtime: AppSurfaceRuntime
  ) => void | Promise<void>;
  commands?: readonly AppSurfaceCommandDescriptor[];
  availabilityFlag?: FlagId;
}

export type AppSurfaceRegistration =
  | AppSurfaceDescriptor
  | (() => Promise<AppSurfaceDescriptor>);

/**
 * A registry lookup deliberately distinguishes an unavailable known surface
 * from an unknown id. Navigation uses that distinction to choose a calm Home
 * fallback only for the former and refuse the latter.
 */
export type AppSurfaceResolution =
  | { status: 'resolved'; descriptor: AppSurfaceDescriptor }
  | { status: 'known-but-unavailable'; descriptor: AppSurfaceDescriptor }
  | { status: 'unknown' };
