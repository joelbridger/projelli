import type { ComponentType, ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import type { AppSurface, NavigationTarget } from '@/platform/types/navigation';
import type { AppSurfaceRuntime } from '@/app/shell/runtime/AppSurfaceRuntime';

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
  ) => void;
  commands?: readonly AppSurfaceCommandDescriptor[];
}

export type AppSurfaceRegistration =
  | AppSurfaceDescriptor
  | (() => Promise<AppSurfaceDescriptor>);
