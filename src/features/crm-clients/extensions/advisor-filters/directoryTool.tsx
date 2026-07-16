import type { ReactNode } from 'react';
import type { DirectoryFeatureContext, DirectoryFeatureToolDescriptor } from '@/features/crm-clients';
import { isEnabled as isFlagEnabled } from '@/platform/flags/router';
import { AdvisorFiltersDirectoryTool } from './AdvisorFiltersDirectoryTool';
import type { AdvisorFilterPreference } from './filterState';

/** Binds the feature's UI to its already-scoped directory state port. */
export const advisorFiltersDirectoryTool: DirectoryFeatureToolDescriptor<AdvisorFilterPreference> = {
  id: 'advisor-filters',
  order: 70,
  isEnabled: () => isFlagEnabled('crm-advisor-filters'),
  mount: (context: DirectoryFeatureContext<AdvisorFilterPreference>): ReactNode => <AdvisorFiltersDirectoryTool context={context} />,
};
