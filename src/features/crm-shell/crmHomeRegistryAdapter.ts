import { crmHomeSurfaceRegistry } from '@/features/crm-home';

export type CrmRailDestination = (typeof crmHomeSurfaceRegistry)[number] & {
  rail: NonNullable<(typeof crmHomeSurfaceRegistry)[number]['rail']>;
};

/**
 * Keep CRM navigation metadata in one place. This frame deliberately consumes
 * the CRM Home contract rather than owning a second set of route labels,
 * icons, shortcuts, or ordering rules.
 */
export function getCrmShellRailDestinations(): readonly CrmRailDestination[] {
  return crmHomeSurfaceRegistry
    .filter(
      (surface): surface is CrmRailDestination => surface.rail !== undefined
    )
    .slice()
    .sort((left, right) => left.rail.order - right.rail.order);
}
