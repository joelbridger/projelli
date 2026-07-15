import { createElement } from 'react';
import type { HouseholdSectionDescriptor } from '../../recordRegistry';
import { InvestmentProfileSection } from './InvestmentProfileSection';

declare module '../../recordRegistry' {
  interface HouseholdSectionIdMap {
    investment_profile: true;
  }
}

/** Ordered after the legacy client-details mount; the flag lives inside the section. */
export const investmentProfileSection: HouseholdSectionDescriptor = {
  id: 'investment_profile',
  order: 40,
  tab: 'client_map',
  mount: ({ household, onSaveHousehold }) =>
    createElement(InvestmentProfileSection, {
      key: household.id,
      household,
      ...(onSaveHousehold ? { onSaveHousehold } : {}),
    }),
};

export { InvestmentProfileSection } from './InvestmentProfileSection';
export {
  EMPTY_INVESTMENT_PROFILE,
  INVESTMENT_PROFILE_DATA_KEY,
  INVESTMENT_OBJECTIVES,
  RISK_TOLERANCES,
  TIME_HORIZONS,
  isInvestmentProfile,
  normalizeInvestmentProfile,
  type InvestmentProfile,
  type InvestmentObjective,
  type RiskTolerance,
  type TimeHorizon,
} from './investmentProfile';
export { readInvestmentProfile, withInvestmentProfile } from './persistence';
