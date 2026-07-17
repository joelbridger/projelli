// A third-party CRM contributor's paved path. Every crm-clients symbol below
// comes from its public index; this fixture intentionally has no deep imports.
import {
  getHouseholdSections,
  householdSectionContextFromRecordIdentity,
  householdSectionRegistry,
  householdTabRegistry,
  toMeetingClientBoundary,
  validateHouseholdSectionDescriptors,
  validateHouseholdTabDescriptors,
  type HouseholdRecordIdentity,
  type HouseholdSectionContext,
  type HouseholdTabDescriptor,
  type HouseholdTabSurfaceProps,
} from '@/features/crm-clients';

const identity: HouseholdRecordIdentity = {
  householdRef: {
    kind: 'household',
    id: 'household-northcrest',
    matterId: 'matter-northcrest',
    label: 'Northcrest household',
  },
  matterId: 'matter-northcrest',
  displayName: 'Northcrest household',
};

export const thirdContributorSectionContext: HouseholdSectionContext =
  householdSectionContextFromRecordIdentity(identity);
export const thirdContributorClientBoundary = toMeetingClientBoundary(identity);

validateHouseholdSectionDescriptors(householdSectionRegistry);
validateHouseholdTabDescriptors(householdTabRegistry);
void getHouseholdSections();

export const thirdContributorTab: HouseholdTabDescriptor | undefined =
  householdTabRegistry.find((tab) => tab.route === 'activity');

export type CrmClientsDoorwayImports = {
  readonly tabProps: HouseholdTabSurfaceProps;
  readonly sectionContext: HouseholdSectionContext;
};
