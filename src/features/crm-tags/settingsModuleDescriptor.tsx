import { UniversalTagsSettingsMount } from './settingsModule';

/** Organization panel mount for reusable firm tags. */
export const universalTagsSettingsPanel = {
  id: 'universal-tags',
  section: 'organization',
  order: 40,
  labelKey: 'crm-tags.settings-label',
  flagId: 'universal-tags',
  searchTerms: ['tag', 'tags', 'task category', 'workflow step'],
  render: () => <UniversalTagsSettingsMount />,
} as const;
