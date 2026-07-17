import {
  type SettingsModuleDescriptor,
  settingsModuleRegistry,
} from '@/features/settings';
import { createElement } from 'react';

/**
 * This outside-Settings fixture is type-checked as a real consumer. Its test
 * registers the descriptor through the public doorway and renders it through
 * the live Settings panel binding.
 */
export const outsideModuleSettingsPanel: SettingsModuleDescriptor = {
  id: 'outside-module-settings-fixture',
  section: 'workspace',
  order: 9_999,
  render: () =>
    createElement(
      'div',
      { 'data-testid': 'outside-module-settings-fixture' },
      'Outside module panel'
    ),
};

export function registerOutsideModuleSettingsPanel(): () => void {
  return settingsModuleRegistry.register(outsideModuleSettingsPanel);
}
