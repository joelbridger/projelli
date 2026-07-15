/** Durable, feature-owned investment facts. This never widens HouseholdRecord. */
export const INVESTMENT_PROFILE_DATA_KEY =
  'investment-profile.profile' as const;

export const INVESTMENT_OBJECTIVES = [
  'growth',
  'income',
  'preservation',
] as const;
export const RISK_TOLERANCES = [
  'conservative',
  'moderate',
  'aggressive',
] as const;
export const TIME_HORIZONS = [
  'under-3-years',
  '3-to-10-years',
  'over-10-years',
] as const;

export type InvestmentObjective = '' | (typeof INVESTMENT_OBJECTIVES)[number];
export type RiskTolerance = '' | (typeof RISK_TOLERANCES)[number];
export type TimeHorizon = '' | (typeof TIME_HORIZONS)[number];

export interface InvestmentProfile {
  investmentObjective: InvestmentObjective;
  riskTolerance: RiskTolerance;
  timeHorizon: TimeHorizon;
  liquidityNeed: string;
}

export const EMPTY_INVESTMENT_PROFILE: InvestmentProfile = {
  investmentObjective: '',
  riskTolerance: '',
  timeHorizon: '',
  liquidityNeed: '',
};

const PROFILE_KEYS = [
  'investmentObjective',
  'riskTolerance',
  'timeHorizon',
  'liquidityNeed',
] as const;
const MAX_VALUE_LENGTH = 280;

function isLiquidityNeed(value: unknown): value is string {
  return typeof value === 'string' && value.length <= MAX_VALUE_LENGTH;
}

function isChoice<T extends string>(
  value: unknown,
  choices: readonly T[]
): value is T | '' {
  return (
    value === '' || (typeof value === 'string' && choices.includes(value as T))
  );
}

/** Reject malformed persisted data before it can reach the record editor. */
export function isInvestmentProfile(
  value: unknown
): value is InvestmentProfile {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (
    Object.keys(candidate).length === PROFILE_KEYS.length &&
    isChoice(candidate['investmentObjective'], INVESTMENT_OBJECTIVES) &&
    isChoice(candidate['riskTolerance'], RISK_TOLERANCES) &&
    isChoice(candidate['timeHorizon'], TIME_HORIZONS) &&
    isLiquidityNeed(candidate['liquidityNeed'])
  );
}

export function normalizeInvestmentProfile(
  value: InvestmentProfile
): InvestmentProfile {
  return {
    investmentObjective: value.investmentObjective,
    riskTolerance: value.riskTolerance,
    timeHorizon: value.timeHorizon,
    liquidityNeed: value.liquidityNeed.trim(),
  };
}
