import {
  RecordKindsBoundaryBlocked,
  RecordKindsSection,
} from './RecordKindsSection';
import type { HouseholdSectionDescriptor } from '../../recordRegistry';

/** Approved alt-familiar Details cards mounted through the public household pair. */
export const recordKindsSection: HouseholdSectionDescriptor = {
  id: 'record-kinds-details',
  order: 15,
  tab: 'client_map',
  mount: (context) => <RecordKindsSection context={context} />,
  mountBlocked: () => <RecordKindsBoundaryBlocked />,
};
