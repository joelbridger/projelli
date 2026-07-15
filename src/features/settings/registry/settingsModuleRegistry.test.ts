import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BASE_SETTINGS_SCHEMA,
  SETTINGS_SCHEMA,
} from '@/platform/settings/schema';
import {
  getSettingsPanelDescriptors,
  getSettingsSectionDescriptors,
  getSettingsModuleDefinitions,
  getVisibleSettingsSectionDescriptors,
  validateSettingsModuleDescriptors,
} from './settingsModuleRegistry';
import type {
  SettingsPanelDescriptor,
  SettingsSectionDescriptor,
} from './types';

describe('settingsModuleRegistry', () => {
  afterEach(() => {
    vi.doUnmock('@/platform/flags/router');
    vi.doUnmock('./legacySettingsSections');
    vi.doUnmock('@/features/crm-firm/teams-roles/settingsModule');
    vi.resetModules();
  });

  it('keeps every legacy section and definition in its existing order', () => {
    expect(
      getVisibleSettingsSectionDescriptors().map((descriptor) => descriptor.id)
    ).toEqual([
      'workspace',
      'ai',
      'privacy',
      'scheduling',
      'voice',
      'advanced',
      'help',
    ]);
    expect(SETTINGS_SCHEMA).toHaveLength(BASE_SETTINGS_SCHEMA.length);
  });

  it('flattens definition keys in byte-for-byte original base order', () => {
    const flattenedKeys = getSettingsModuleDefinitions()
      .map((definition) => definition.key)
      .join('\n');
    const baseKeys = BASE_SETTINGS_SCHEMA.map(
      (definition) => definition.key
    ).join('\n');

    expect(flattenedKeys).toBe(baseKeys);
  });

  it('rejects duplicate settings section ids', () => {
    const descriptors = getSettingsSectionDescriptors();
    const workspace = descriptors[0];
    expect(workspace).toBeDefined();
    if (workspace === undefined) {
      throw new Error('Expected workspace settings descriptor');
    }
    expect(() => {
      validateSettingsModuleDescriptors([...descriptors, workspace], []);
    }).toThrow('duplicate section id: workspace');
  });

  it('rejects an Organization descriptor without a namespaced label key', () => {
    const organization = getSettingsSectionDescriptors().find(
      (descriptor) => descriptor.id === 'workspace'
    );
    expect(organization).toBeDefined();
    if (!organization) throw new Error('Expected a settings descriptor');
    expect(() => {
      validateSettingsModuleDescriptors(
        [
          ...getSettingsSectionDescriptors().filter(
            (descriptor) =>
              descriptor.id !== 'workspace' && descriptor.id !== 'organization'
          ),
          { ...organization, id: 'organization', labelKey: 'organization' },
        ],
        []
      );
    }).toThrow('labelKey must include a namespace: organization');
  });

  it('adds Organization only when the Teams & Roles flag is on', async () => {
    vi.resetModules();
    vi.doMock('@/platform/flags/router', () => ({
      isEnabled: (id: string) => id === 'teams-roles',
    }));
    const enabledRegistry = await import('./settingsModuleRegistry');
    expect(
      enabledRegistry
        .getVisibleSettingsSectionDescriptors()
        .map((descriptor) => descriptor.id)
    ).toEqual([
      'workspace',
      'ai',
      'privacy',
      'scheduling',
      'voice',
      'advanced',
      'help',
      'organization',
    ]);
    expect(
      enabledRegistry.getSettingsPanelDescriptors('organization')[0]?.render
    ).toBeTypeOf('function');
  });

  it('rejects duplicate panel ids, unknown target sections, and duplicate keys across sections and panels', () => {
    const section: SettingsSectionDescriptor = {
      id: 'workspace',
      order: 1,
      labelKey: 'settings.sections.workspace',
      legacyLabel: 'Workspace',
      definitions: [
        {
          key: 'shared',
          category: 'workspace',
          label: 'Shared',
          description: '',
          type: 'text',
          defaultValue: '',
        },
      ],
    };
    const panel: SettingsPanelDescriptor = {
      id: 'fake-panel',
      section: 'workspace',
      order: 1,
      render: () => null,
    };
    expect(() =>
      validateSettingsModuleDescriptors([section], [panel, panel])
    ).toThrow('duplicate panel id: fake-panel');
    expect(() =>
      validateSettingsModuleDescriptors(
        [section],
        [{ ...panel, section: 'organization' }]
      )
    ).toThrow('panel belongs to an unknown section: fake-panel');
    expect(() =>
      validateSettingsModuleDescriptors(
        [section],
        [
          {
            ...panel,
            definitions: [
              {
                key: 'shared',
                category: 'workspace',
                label: 'Shared',
                description: '',
                type: 'text',
                defaultValue: '',
              },
            ],
          },
        ]
      )
    ).toThrow('duplicate setting key: shared');
  });

  it('keeps legacy rail order, visibility, and schema order unchanged', () => {
    expect(
      getSettingsSectionDescriptors().map((descriptor) => descriptor.id)
    ).toEqual([
      'workspace',
      'ai',
      'privacy',
      'scheduling',
      'voice',
      'advanced',
      'help',
      'organization',
    ]);
    expect(
      getVisibleSettingsSectionDescriptors().map((descriptor) => descriptor.id)
    ).toEqual([
      'workspace',
      'ai',
      'privacy',
      'scheduling',
      'voice',
      'advanced',
      'help',
    ]);
    expect(
      getSettingsPanelDescriptors('workspace').map((panel) => panel.id)
    ).toEqual(['legacy-workspace']);
  });

  it('hides a registered flag-gated panel while dark and restores it when enabled', async () => {
    const alwaysVisible: SettingsPanelDescriptor = {
      id: 'fake-always',
      section: 'organization',
      order: 10,
      render: () => null,
    };
    const gated: SettingsPanelDescriptor = {
      id: 'fake-gated',
      section: 'organization',
      order: 20,
      flagId: 'teams-roles',
      render: () => null,
    };
    let flagOn = false;
    vi.resetModules();
    vi.doMock('@/platform/flags/router', () => ({
      isEnabled: () => flagOn,
    }));
    vi.doMock('./legacySettingsSections', () => ({
      legacySettingsSections: [],
      legacySettingsPanels: [alwaysVisible, gated],
    }));
    vi.doMock('@/features/crm-firm/teams-roles/settingsModule', () => ({
      teamsRolesSettingsPanel: {
        id: 'teams-roles',
        section: 'organization',
        order: 30,
        render: () => null,
      },
    }));
    const registry = await import('./settingsModuleRegistry');

    expect(
      registry
        .getSettingsPanelDescriptors('organization')
        .map((panel) => panel.id)
    ).toEqual(['fake-always', 'teams-roles']);
    flagOn = true;
    expect(
      registry
        .getSettingsPanelDescriptors('organization')
        .map((panel) => panel.id)
    ).toEqual(['fake-always', 'fake-gated', 'teams-roles']);
  });
});
