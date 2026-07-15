import type { ComponentType } from 'react';
import type { LucideIcon } from 'lucide-react';
import type { FlagId } from '@/platform/flags';

/**
 * Feature-owned CRM Home routes extend this map beside their descriptor.
 * There is deliberately no string index signature: a typo is a type error.
 */
export interface CrmHomeRouteMap {}

export type CrmHomeRoute = Extract<keyof CrmHomeRouteMap, string>;

export interface CrmHomeRailPlacement {
  group: string;
  order: number;
}

/** One CRM Home destination and all of its navigation metadata. */
export interface CrmHomeSurfaceDescriptor {
  id: string;
  labelKey: string;
  icon: LucideIcon;
  route: CrmHomeRoute;
  Component: ComponentType;
  rail?: CrmHomeRailPlacement;
  parentRoute?: CrmHomeRoute;
  shortcut?: string;
  /** Optional dark-launch guard. Unguarded surfaces remain visible. */
  flagId?: FlagId;
}
