import type { HouseholdRecord } from '../../adapters';
import {
  EMPTY_INVESTMENT_PROFILE,
  INVESTMENT_PROFILE_DATA_KEY,
  isInvestmentProfile,
  normalizeInvestmentProfile,
  type InvestmentProfile,
} from './investmentProfile';

/** Reads this extension only; unknown extension namespaces remain untouched. */
export function readInvestmentProfile(
  household: HouseholdRecord
): InvestmentProfile {
  const value = household.extensionData?.[INVESTMENT_PROFILE_DATA_KEY];
  return value !== undefined && isInvestmentProfile(value)
    ? value
    : { ...EMPTY_INVESTMENT_PROFILE };
}

/** Produces a full record save without altering another feature's extension bag. */
export function withInvestmentProfile(
  household: HouseholdRecord,
  value: InvestmentProfile
): HouseholdRecord {
  const profile = normalizeInvestmentProfile(value);
  if (!isInvestmentProfile(profile)) {
    throw new Error('Investment profile contains an invalid value.');
  }
  return {
    ...household,
    extensionData: {
      ...household.extensionData,
      [INVESTMENT_PROFILE_DATA_KEY]: profile,
    },
  };
}
