import type { ReactNode } from 'react';
import type { DirectoryFeatureContext, DirectoryFeatureToolDescriptor } from '@/features/crm-clients';
import { isEnabled as isFlagEnabled } from '@/platform/flags/router';
import { TagsRailDirectoryTool } from './TagsRailDirectoryTool';
import type { TagRailSelection } from './filterState';

/** Binds the feature's UI to its already-scoped directory state port. */
export const crmTagsRailDirectoryTool: DirectoryFeatureToolDescriptor<TagRailSelection> = {
  id: 'crm-tags-rail',
  order: 75,
  isEnabled: () => isFlagEnabled('crm-tags-rail'),
  mount: (context: DirectoryFeatureContext<TagRailSelection>): ReactNode => (
    <TagsRailDirectoryTool context={context} />
  ),
};
