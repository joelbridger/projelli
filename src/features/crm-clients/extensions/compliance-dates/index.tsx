import { isEnabled } from '@/platform/flags/router';
import type {
  HouseholdRecordExtensionDescriptor,
  HouseholdSectionDescriptor,
} from '../../recordRegistry';
import { COMPLIANCE_DATES_DATA_KEY } from './persistence';
import { EMPTY_COMPLIANCE_DATES, type ComplianceDatesPayload } from './types';
import { isComplianceDatesPayload } from './validation';
import { WrittenAgreementsSection } from './WrittenAgreementsSection';

declare module '../../recordRegistry' {
  interface HouseholdSectionIdMap {
    'written-agreements': true;
  }
  interface HouseholdRecordExtensionKeyMap {
    'compliance-dates.written-agreements': true;
  }
}

export const complianceDatesRecordExtension: HouseholdRecordExtensionDescriptor<ComplianceDatesPayload> =
  {
    id: 'compliance-dates-written-agreements',
    dataKey: COMPLIANCE_DATES_DATA_KEY,
    defaultValue: EMPTY_COMPLIANCE_DATES,
    validate: isComplianceDatesPayload,
  };

/** The ordered record-section descriptor mounted through the landed P0-E seam. */
export const writtenAgreementsSection: HouseholdSectionDescriptor = {
  id: 'written-agreements',
  order: 40,
  tab: 'client_map',
  mount: ({ household, onSaveHousehold }) =>
    isEnabled('record-compliance-dates') ? (
      <WrittenAgreementsSection
        household={household}
        {...(onSaveHousehold ? { onSaveHousehold } : {})}
      />
    ) : null,
};

export {
  COMPLIANCE_DATES_DATA_KEY,
  persistComplianceDates,
} from './persistence';
export { EMPTY_COMPLIANCE_DATES } from './types';
export {
  isComplianceDatesPayload,
  isValidComplianceDate,
  readComplianceDates,
  validateComplianceDates,
} from './validation';
export { WrittenAgreementsSection } from './WrittenAgreementsSection';
