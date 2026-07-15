import { afterEach, describe, expect, it, vi } from 'vitest';
import { BASE_SETTINGS_SCHEMA, SETTINGS_SCHEMA } from '@/platform/settings/schema';
import {
  getSettingsModuleDescriptors,
  getSettingsModuleDescriptor,
  getSettingsModuleDefinitions,
  validateSettingsModuleDescriptors,
} from './settingsModuleRegistry';

describe('settingsModuleRegistry', () => {
  afterEach(() => {
    vi.doUnmock('@/platform/flags/router');
    vi.resetModules();
  });

  it('keeps every legacy section and definition in its existing order', () => {
    expect(getSettingsModuleDescriptors().map((descriptor) => descriptor.id)).toEqual([
      'workspace', 'ai', 'privacy', 'scheduling', 'voice', 'advanced', 'help',
    ]);
    expect(SETTINGS_SCHEMA).toHaveLength(BASE_SETTINGS_SCHEMA.length);
  });

  it('flattens definition keys in byte-for-byte original base order', () => {
    const flattenedKeys = getSettingsModuleDefinitions().map((definition) => definition.key).join('\n');
    const baseKeys = BASE_SETTINGS_SCHEMA.map((definition) => definition.key).join('\n');

    expect(flattenedKeys).toBe(baseKeys);
  });

  it('rejects duplicate settings section ids', () => {
    const descriptors = getSettingsModuleDescriptors();
    const workspace = descriptors[0];
    expect(workspace).toBeDefined();
    if (workspace === undefined) {
      throw new Error('Expected workspace settings descriptor');
    }
    expect(() => {
      validateSettingsModuleDescriptors([...descriptors, workspace]);
    }).toThrow(
      'duplicate section id: workspace',
    );
  });

  it('rejects an Organization descriptor without a namespaced label key', () => {
    const organization = getSettingsModuleDescriptor('workspace');
    expect(organization).toBeDefined();
    if (!organization) throw new Error('Expected a settings descriptor');
    expect(() => {
      validateSettingsModuleDescriptors([
        ...getSettingsModuleDescriptors(),
        { ...organization, id: 'organization-test', labelKey: 'organization' },
      ]);
    }).toThrow('labelKey must include a namespace: organization-test');
  });

  it('adds Organization only when the Teams & Roles flag is on', async () => {
    vi.resetModules();
    vi.doMock('@/platform/flags/router', () => ({
      isEnabled: (id: string) => id === 'teams-roles',
    }));
    const enabledRegistry = await import('./settingsModuleRegistry');
    expect(enabledRegistry.getSettingsModuleDescriptors().map((descriptor) => descriptor.id)).toEqual([
      'workspace', 'ai', 'privacy', 'scheduling', 'voice', 'advanced', 'help', 'organization',
    ]);
    expect(enabledRegistry.getSettingsModuleDescriptor('organization')?.render).toBeTypeOf('function');
  });
});
