import { ContactSourcesSettings } from './settingsModule';

/** Organization panel mount; Settings composes this with other firm panels. */
export const contactSourcesSettingsPanel = {
  id: 'contact-sources',
  section: 'organization',
  order: 20,
  labelKey: 'contact-sources.settings-label',
  flagId: 'contact-sources',
  searchTerms: ['contact', 'source', 'referral', 'lead'],
  render: () => <ContactSourcesSettings />,
} as const;
