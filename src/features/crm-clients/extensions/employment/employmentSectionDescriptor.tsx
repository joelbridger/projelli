import { EMPLOYMENT_EXTENSION_KEY } from './types';
import type { HouseholdSectionDescriptor } from '../../recordRegistry';
import { EmploymentSection } from './EmploymentSection';

/** Ordered after Professional contacts (10) and before the remaining profile sections. */
export const employmentHouseholdSection: HouseholdSectionDescriptor = {
  id: 'employment',
  order: 20,
  tab: 'client_map',
  mount: ({ household, onSaveHousehold }) => (
    <EmploymentSection
      key={`${household.id}:${JSON.stringify(
        household.extensionData?.[EMPLOYMENT_EXTENSION_KEY]
      )}:${household.members.map((member) => member.id).join(',')}`}
      household={household}
      {...(onSaveHousehold ? { onSaveHousehold } : {})}
    />
  ),
};
