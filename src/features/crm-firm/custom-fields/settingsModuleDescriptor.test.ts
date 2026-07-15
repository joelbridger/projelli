import { describe, expect, it } from 'vitest';
import { customFieldsSettingsModule } from './settingsModuleDescriptor';

describe('custom fields Organization settings mount', () => {
  it('describes one namespaced, dark panel in the existing Organization section', () => {
    expect(customFieldsSettingsModule).toEqual(
      expect.objectContaining({
        id: 'custom-fields-firm',
        section: 'organization',
        labelKey: 'custom-fields.settings-label',
        flagId: 'custom-fields-firm',
      })
    );
    expect(customFieldsSettingsModule.order).toBe(20);
  });
});
