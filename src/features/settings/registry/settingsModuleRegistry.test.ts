import { describe, expect, it } from 'vitest';
import { BASE_SETTINGS_SCHEMA, SETTINGS_SCHEMA } from '@/platform/settings/schema';
import {
  getSettingsModuleDescriptors,
  validateSettingsModuleDescriptors,
} from './settingsModuleRegistry';

describe('settingsModuleRegistry', () => {
  it('keeps every legacy section and definition in its existing order', () => {
    expect(getSettingsModuleDescriptors().map((descriptor) => descriptor.id)).toEqual([
      'workspace', 'ai', 'privacy', 'scheduling', 'voice', 'advanced', 'help',
    ]);
    expect(SETTINGS_SCHEMA).toHaveLength(BASE_SETTINGS_SCHEMA.length);
  });

  it('rejects duplicate settings section ids', () => {
    const descriptors = getSettingsModuleDescriptors();
    const workspace = descriptors[0];
    expect(workspace).toBeDefined();
    expect(() => validateSettingsModuleDescriptors([...descriptors, workspace!])).toThrow(
      'duplicate section id: workspace',
    );
  });
});
