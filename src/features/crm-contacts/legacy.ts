import type { HouseholdRecord } from '@/features/crm-clients';
import type { LegacyEmbeddedContactProjection } from './types';

/**
 * Read-only bridge for the old embedded household member arrays. It never
 * creates durable records or relationship links; new work uses ContactRecordStore.
 */
export function adaptLegacyHouseholdRecord(household: HouseholdRecord): readonly LegacyEmbeddedContactProjection[] {
  return [...household.members, ...household.externalParties].map((person) => ({
    id: person.id,
    kind: person.personType,
    name: person.name,
    personType: person.personType,
    roles: person.roles,
    ...(person.householdRole ? { householdRole: person.householdRole } : {}),
    ...(person.external !== undefined ? { external: person.external } : {}),
    relatedHouseholds: person.relatedHouseholds,
    ...(person.channel ? { channel: person.channel } : {}),
    ...(person.verifiedAt ? { verifiedAt: person.verifiedAt } : {}),
    ...(person.verifiedBy ? { verifiedBy: person.verifiedBy } : {}),
    ...(person.companyName ? { companyName: person.companyName } : {}),
    ...(person.jobTitle ? { jobTitle: person.jobTitle } : {}),
    ...(person.addresses ? { addresses: person.addresses } : {}),
    ...(person.emails ? { emails: person.emails } : {}),
    ...(person.phones ? { phones: person.phones } : {}),
    ...(person.contextRefs ? { contextRefs: person.contextRefs } : {}),
  }));
}
