import { TeamsRolesSettings } from './settingsModule';

/** Organization panel mount; the registry owns its rail section. */
export const teamsRolesSettingsModule = {
  id: 'teams-roles',
  section: 'organization',
  order: 10,
  labelKey: 'teams-roles.settings-label',
  flagId: 'teams-roles',
  searchTerms: [
    'people',
    'teams',
    'roles',
    'permissions',
    'advisor',
    'compliance',
  ],
  groups: [
    {
      id: 'teams-roles-directory',
      section: 'organization',
      keywords: ['directory'],
    },
  ],
  render: TeamsRolesSettings,
} as const;
