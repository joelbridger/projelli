import { NotificationPreferencesSettings } from './NotificationPreferencesSettings';

declare module '@/platform/types/settings' {
  interface SettingsSectionMap {
    personal: true;
  }
}

/** New, user-owned rail section. It stays hidden until this flagged panel is visible. */
export const notificationPreferencesSettingsSection = {
  id: 'personal',
  order: 75,
  labelKey: 'notification-preferences.settings-section-label',
  legacyLabel: 'My settings',
  searchTerms: ['my settings', 'personal', 'notifications', 'alerts'],
} as const;

/** Personal preference mount. Future delivery lanes consume its read-only contract. */
export const notificationPreferencesSettingsPanel = {
  id: 'notification-preferences',
  section: 'personal',
  order: 10,
  labelKey: 'notification-preferences.title',
  flagId: 'notification-preferences',
  searchTerms: ['notifications', 'mentions', 'assignments', 'approvals', 'reminders', 'digest'],
  render: NotificationPreferencesSettings,
} as const;
