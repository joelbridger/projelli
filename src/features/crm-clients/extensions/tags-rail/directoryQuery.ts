import type {
  DirectoryContribution,
  DirectoryFeatureQueryDescriptor,
  DirectoryResult,
} from '@/features/crm-clients';
import { isEnabled as isFlagEnabled } from '@/platform/flags/router';
import { crmTagsRailDirectoryTool } from './directoryTool';
import { hasSelectedTags, type TagRailSelection } from './filterState';

function resultTagIds(result: DirectoryResult): readonly string[] {
  return result.record.tagIds ?? [];
}

function matchesSelectedTags(result: DirectoryResult, selectedTagIds: TagRailSelection): boolean {
  const selected = new Set(selectedTagIds);
  return resultTagIds(result).some((tagId) => selected.has(tagId));
}

/** Filters copied directory projections with an OR match across selected stable tag IDs. */
export const crmTagsRailDirectoryQuery: DirectoryFeatureQueryDescriptor<TagRailSelection> = {
  id: 'crm-tags-rail',
  order: 75,
  isActive: (context) => isFlagEnabled('crm-tags-rail')
    && hasSelectedTags(context.featureState.get() ?? []),
  filter: (result, context) => matchesSelectedTags(result, context.featureState.get() ?? []),
};

/** The single stateful contribution the directory host composes into its tool and query pipeline. */
export const crmTagsRailDirectoryContribution: DirectoryContribution<TagRailSelection> = {
  namespace: 'crm-tags-rail',
  tools: [crmTagsRailDirectoryTool],
  queries: [crmTagsRailDirectoryQuery],
};
