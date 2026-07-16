import { createDirectoryPreferenceStore } from '@/features/crm-clients';

export type TagRailSelection = readonly string[];

export const EMPTY_TAG_RAIL_SELECTION: TagRailSelection = Object.freeze([]);

function isTagRailSelection(value: unknown): value is TagRailSelection {
  return Array.isArray(value)
    && value.every((id) => typeof id === 'string' && id.trim().length > 0)
    && new Set(value).size === value.length;
}

/** The feature's one sanctioned saved-preference slot. */
export const tagRailPreferences = createDirectoryPreferenceStore<TagRailSelection>(
  'crm-tags-rail',
  isTagRailSelection,
);

export function readTagRailSelection(): TagRailSelection {
  return tagRailPreferences.load() ?? EMPTY_TAG_RAIL_SELECTION;
}

export function hasSelectedTags(selection: TagRailSelection): boolean {
  return selection.length > 0;
}
