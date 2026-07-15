import type { HouseholdSectionDescriptor } from '../../recordRegistry';
import { EmploymentSection } from './EmploymentSection';

declare module '../../recordRegistry' {
  interface HouseholdSectionIdMap {
    employment: true;
  }
}

export { EmploymentSection } from './EmploymentSection';
export {
  persistEmploymentInformation,
  readEmploymentInformation,
} from './persistence';
export {
  EMPTY_EMPLOYMENT_INFORMATION,
  EMPLOYMENT_EXTENSION_KEY,
  isEmploymentInformation,
  type EmploymentInformation,
  type EmploymentMemberInformation,
} from './types';

/** Ordered after Professional contacts (10) and before the remaining profile sections. */
export const employmentHouseholdSection: HouseholdSectionDescriptor = {
  id: 'employment',
  order: 20,
  tab: 'client_map',
  mount: ({ household, onSaveHousehold }) => (
    <EmploymentSection
      household={household}
      {...(onSaveHousehold ? { onSaveHousehold } : {})}
    />
  ),
};
