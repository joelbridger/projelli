import type { HouseholdRecord } from '../../adapters';
import type { ComplianceDatesPayload } from './types';

export const COMPLIANCE_DATES_DATA_KEY =
  'compliance-dates.written-agreements' as const;

/**
 * Makes the extension bag update explicit and lossless. The record owner still
 * performs the actual durable write through its existing save adapter.
 */
export function persistComplianceDates(
  household: HouseholdRecord,
  dates: ComplianceDatesPayload
): HouseholdRecord {
  return {
    ...household,
    extensionData: {
      ...household.extensionData,
      [COMPLIANCE_DATES_DATA_KEY]: { ...dates },
    },
  };
}
