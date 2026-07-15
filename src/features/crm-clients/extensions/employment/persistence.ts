import type { HouseholdRecord } from '../../adapters';
import {
  EMPTY_EMPLOYMENT_INFORMATION,
  EMPLOYMENT_EXTENSION_KEY,
  isEmploymentInformation,
  type EmploymentInformation,
} from './types';

/** Reads only this extension's bag and safely ignores malformed older values. */
export function readEmploymentInformation(
  household: Pick<HouseholdRecord, 'extensionData'>
): EmploymentInformation {
  const candidate = household.extensionData?.[EMPLOYMENT_EXTENSION_KEY];
  return isEmploymentInformation(candidate)
    ? candidate
    : EMPTY_EMPLOYMENT_INFORMATION;
}

/** Produces the normal household save payload without widening the shared record. */
export function persistEmploymentInformation(
  household: HouseholdRecord,
  information: EmploymentInformation
): HouseholdRecord {
  if (!isEmploymentInformation(information))
    throw new Error('Cannot persist invalid employment information');

  return {
    ...household,
    extensionData: {
      ...household.extensionData,
      [EMPLOYMENT_EXTENSION_KEY]: information,
    },
  };
}
