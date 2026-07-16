import type {
  DirectoryContribution,
  DirectoryFeatureQueryDescriptor,
  DirectoryResult,
} from '@/features/crm-clients';
import { isEnabled as isFlagEnabled } from '@/platform/flags/router';
import { advisorFiltersDirectoryTool } from './directoryTool';
import { hasAdvisorFilters, type AdvisorFilterPreference } from './filterState';

function matchesAdvisorFilters(
  result: DirectoryResult,
  filters: AdvisorFilterPreference,
): boolean {
  if (result.kind !== 'household') return true;
  return (filters.primaryAdvisor === null
      || result.record.primaryAdvisor === filters.primaryAdvisor)
    && (filters.serviceTier === null || result.record.serviceTier === filters.serviceTier)
    && (filters.lifecycle === null || result.record.lifecycle === filters.lifecycle);
}

/**
 * Applies this mounted directory's advisor-owned state to copied household
 * projections. Person results are deliberately untouched: those fields are
 * not part of their public directory record contract.
 */
export const advisorFiltersDirectoryQuery: DirectoryFeatureQueryDescriptor<AdvisorFilterPreference> = {
  id: 'advisor-filters',
  order: 70,
  isActive: (context) => isFlagEnabled('crm-advisor-filters')
    && hasAdvisorFilters(context.featureState.get() ?? {
      primaryAdvisor: null,
      serviceTier: null,
      lifecycle: null,
    }),
  filter: (result, context) => matchesAdvisorFilters(
    result,
    context.featureState.get() ?? {
      primaryAdvisor: null,
      serviceTier: null,
      lifecycle: null,
    },
  ),
};

/** The single contribution the directory host composes into its query pipeline. */
export const advisorFiltersDirectoryContribution: DirectoryContribution<AdvisorFilterPreference> = {
  namespace: 'crm-advisor-filters',
  tools: [advisorFiltersDirectoryTool],
  queries: [advisorFiltersDirectoryQuery],
};
