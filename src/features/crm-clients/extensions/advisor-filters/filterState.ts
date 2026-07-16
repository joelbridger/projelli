import { createDirectoryPreferenceStore } from '@/features/crm-clients';

export interface AdvisorFilterPreference {
  primaryAdvisor: string | null;
  serviceTier: string | null;
  lifecycle: string | null;
}

export const EMPTY_ADVISOR_FILTERS: AdvisorFilterPreference = Object.freeze({
  primaryAdvisor: null,
  serviceTier: null,
  lifecycle: null,
});

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function isAdvisorFilterPreference(value: unknown): value is AdvisorFilterPreference {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const preference = value as Partial<AdvisorFilterPreference>;
  return isNullableString(preference.primaryAdvisor)
    && isNullableString(preference.serviceTier)
    && isNullableString(preference.lifecycle);
}

/** The feature's one sanctioned saved-preference slot. */
export const advisorFilterPreferences = createDirectoryPreferenceStore(
  'crm-advisor-filters',
  isAdvisorFilterPreference,
);

export function readAdvisorFilters(): AdvisorFilterPreference {
  return advisorFilterPreferences.load() ?? EMPTY_ADVISOR_FILTERS;
}

export function hasAdvisorFilters(filters: AdvisorFilterPreference): boolean {
  return Object.values(filters).some((value) => value !== null);
}
