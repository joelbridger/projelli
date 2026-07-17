import type { HouseholdRecordShellSectionDescriptor } from '../../recordRegistry';
import { ProfessionalContactsSection } from './ProfessionalContactsSection';

declare module '../../recordRegistry' {
  interface HouseholdSectionIdMap {
    'professional-contacts': true;
  }
}

/** Appended after the legacy client-map section; the feature stays dark by default. */
export const professionalContactsSection: HouseholdRecordShellSectionDescriptor = {
  id: 'professional-contacts',
  order: 20,
  tab: 'client_map',
  mount: (context) => <ProfessionalContactsSection {...context} />,
};
