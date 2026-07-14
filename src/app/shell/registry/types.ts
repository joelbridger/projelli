import type { ComponentType, ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import type { AppSurface, NavigationTarget } from '@/platform/types/navigation';
import type { AppSurfaceRuntime } from '@/app/shell/runtime/AppSurfaceRuntime';

export type AppSurfaceId = AppSurface;
export type AppSurfacePlacement = 'primary' | 'utility' | 'hidden';
export type AppSurfaceClientContext = 'shared' | 'firm' | 'preserve-hidden';

export interface AppSurfaceCommandDescriptor {
  id: string;
  labelKey: string;
  shortcut?: string;
}

export interface AppSurfaceComponentProps {
  runtime: AppSurfaceRuntime;
}

export type AppSurfaceComponent = ComponentType<AppSurfaceComponentProps>;

/**
 * One source of truth for a top-level surface's mount and shell metadata.
 * `legacyLabel` exists only to preserve the current untranslated Home/Clients
 * labels during this pure refactor; new surfaces should use `labelKey` alone.
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
  load: () => Promise<{ default: AppSurfaceComponent }>;
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
