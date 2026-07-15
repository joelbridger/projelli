import { CustomFieldsSettings } from './settingsModule';

/** Organization panel mount; the Settings registry owns this rail section. */
export const customFieldsSettingsModule = {
  id: 'custom-fields-firm',
  section: 'organization',
  order: 20,
  labelKey: 'custom-fields.settings-label',
  flagId: 'custom-fields-firm',
  searchTerms: ['custom fields', 'client fields', 'field types', 'choices'],
  groups: [
    {
      id: 'custom-fields-catalog',
      section: 'organization',
      keywords: ['custom', 'fields'],
    },
  ],
  render: CustomFieldsSettings,
} as const;
