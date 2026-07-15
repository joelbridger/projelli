import { createElement } from 'react';
import { TeamsRolesSettings } from './settingsModule';

export const teamsRolesSettingsModule = {
  id: 'organization' as const,
  order: 80,
  labelKey: 'teams-roles.settings-label',
  legacyLabel: 'Organization',
  searchTerms: [
    'people',
    'teams',
    'roles',
    'permissions',
    'advisor',
    'compliance',
  ],
  render: () => createElement(TeamsRolesSettings),
};
