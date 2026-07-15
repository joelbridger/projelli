// Public notifications doorway. Feature consumers must cross this boundary
// instead of importing a private notifications implementation path.
export {
  notificationPreferencesSettingsPanel,
  notificationPreferencesSettingsSection,
} from './preferences';
