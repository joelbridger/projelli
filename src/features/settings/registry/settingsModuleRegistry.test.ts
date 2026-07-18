import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { setDevFlagOverride } from '@/platform/flags';
import {
  BASE_SETTINGS_SCHEMA,
  SETTINGS_SCHEMA,
} from '@/platform/settings/schema';
import {
  getSettingsPanelDescriptors,
  getSettingsSearchSectionDescriptors,
  getSettingsSectionDescriptors,
  getSettingsModuleDefinitions,
  settingsPanelRegistry,
  getVisibleSettingsSectionDescriptors,
  validateSettingsModuleDescriptors,
} from './settingsModuleRegistry';
import type {
  SettingsPanelDescriptor,
  SettingsSectionDescriptor,
} from './types';

describe('settingsModuleRegistry', () => {
  afterEach(() => {
    setDevFlagOverride('booking-availability', undefined);
    setDevFlagOverride('data-export-backup', undefined);
    vi.doUnmock('@/platform/flags/router');
    vi.doUnmock('./legacySettingsSections');
    vi.doUnmock('@/features/crm-firm');
    vi.doUnmock('@/features/notifications/preferences');
    vi.doUnmock('@/features/booking');
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
    expect(() => {
      validateSettingsModuleDescriptors([section], [panel, panel]);
    }).toThrow('duplicate panel id: fake-panel');
    expect(() => {
      validateSettingsModuleDescriptors(
        [section],
        [{ ...panel, section: 'organization' }]
      );
    }).toThrow('panel belongs to an unknown section: fake-panel');
    expect(() => {
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
      );
    }).toThrow('duplicate setting key: shared');
  });

  it('rejects panel-shaped objects in the section list', () => {
    const invalidSection = {
      id: 'workspace',
      order: 1,
      labelKey: 'settings.sections.workspace',
      legacyLabel: 'Workspace',
      section: 'workspace',
      render: () => null,
    } as unknown as SettingsSectionDescriptor;
    expect(() => {
      validateSettingsModuleDescriptors([invalidSection], []);
    }).toThrow('panel-shaped object in section list: workspace');
  });

  it('rejects a duplicate panel id across different sections', () => {
    const sections: SettingsSectionDescriptor[] = [
      {
        id: 'workspace',
        order: 1,
        labelKey: 'settings.sections.workspace',
        legacyLabel: 'Workspace',
      },
      {
        id: 'organization',
        order: 2,
        labelKey: 'teams-roles.settings-label',
        legacyLabel: 'Organization',
      },
    ];
    const first: SettingsPanelDescriptor = {
      id: 'shared-panel',
      section: 'workspace',
      order: 1,
      render: () => null,
    };
    const second: SettingsPanelDescriptor = {
      ...first,
      section: 'organization',
    };
    expect(() => {
      validateSettingsModuleDescriptors(sections, [first, second]);
    }).toThrow('duplicate panel id: shared-panel');
  });

  it('rejects duplicate setting keys across two different panels', () => {
    const section: SettingsSectionDescriptor = {
      id: 'workspace',
      order: 1,
      labelKey: 'settings.sections.workspace',
      legacyLabel: 'Workspace',
    };
    const definition = {
      key: 'shared-panel-key',
      category: 'workspace' as const,
      label: 'Shared',
      description: '',
      type: 'text' as const,
      defaultValue: '',
    };
    const first: SettingsPanelDescriptor = {
      id: 'first-panel',
      section: 'workspace',
      order: 1,
      definitions: [definition],
      render: () => null,
    };
    const second: SettingsPanelDescriptor = {
      id: 'second-panel',
      section: 'workspace',
      order: 2,
      definitions: [definition],
      render: () => null,
    };
    expect(() => {
      validateSettingsModuleDescriptors([section], [first, second]);
    }).toThrow('duplicate setting key: shared-panel-key');
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
      'personal',
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
      getSettingsSearchSectionDescriptors().map((descriptor) => descriptor.id)
    ).toEqual([
      'workspace',
      'ai',
      'privacy',
      'scheduling',
      'voice',
      'advanced',
      'help',
      'personal',
      'organization',
    ]);
    expect(
      getSettingsPanelDescriptors('workspace').map((panel) => panel.id)
    ).toEqual(['legacy-workspace']);
  });

  it('registers the Personal section and notification panel as a valid new-section pair', () => {
    const personal = getSettingsSectionDescriptors().find(
      (descriptor) => descriptor.id === 'personal'
    );
    const notifications = settingsPanelRegistry.find(
      (panel) => panel.id === 'notification-preferences'
    );

    expect(personal).toEqual(
      expect.objectContaining({
        id: 'personal',
        legacyLabel: 'My settings',
        labelKey: 'notification-preferences.settings-section-label',
      })
    );
    expect(notifications).toEqual(
      expect.objectContaining({
        id: 'notification-preferences',
        section: 'personal',
        flagId: 'notification-preferences',
      })
    );
    expect(getSettingsPanelDescriptors('personal')).toEqual([]); // Dark panels never mount.
    expect(() => {
      validateSettingsModuleDescriptors(
        getSettingsSectionDescriptors(),
        settingsPanelRegistry
      );
    }).not.toThrow();
  });

  it('registers booking availability as the dark Scheduling panel', () => {
    const bookingAvailability = settingsPanelRegistry.find(
      (panel) => panel.id === 'booking-availability'
    );

    expect(bookingAvailability).toEqual(
      expect.objectContaining({
        id: 'booking-availability',
        section: 'scheduling',
        flagId: 'booking-availability',
      })
    );
    expect(getSettingsPanelDescriptors('scheduling')).not.toContain(
      bookingAvailability
    );
  });

  it('mounts the real booking availability panel through the enabled Settings doorway', () => {
    setDevFlagOverride('booking-availability', true);

    const bookingAvailability = getSettingsPanelDescriptors('scheduling').find(
      (panel) => panel.id === 'booking-availability'
    );

    expect(bookingAvailability).toBeDefined();
    if (!bookingAvailability) {
      throw new Error(
        'Expected the enabled booking availability Settings panel'
      );
    }

    render(createElement(bookingAvailability.render));

    expect(
      screen.getByTestId('booking-availability-settings')
    ).toBeInTheDocument();
  });

  it('mounts the one real data export panel through the Workspace Settings doorway', () => {
    expect(
      getSettingsPanelDescriptors('workspace').filter(
        (panel) => panel.id === 'data-portability'
      )
    ).toEqual([]);

    setDevFlagOverride('data-export-backup', true);
    const matches = getSettingsPanelDescriptors('workspace').filter(
      (panel) => panel.id === 'data-portability'
    );

    expect(matches).toHaveLength(1);
    const dataPortability = matches[0];
    if (!dataPortability) {
      throw new Error('Expected the data export Settings panel');
    }

    render(createElement(dataPortability.render));

    expect(screen.getByTestId('data-portability-settings')).toBeInTheDocument();
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
      isEnabled: (id: string) => id === 'teams-roles' && flagOn,
    }));
    vi.doMock('./legacySettingsSections', () => ({
      legacySettingsSections: [
        {
          id: 'workspace',
          order: 10,
          labelKey: 'settings.sections.workspace',
          legacyLabel: 'Workspace',
        },
        {
          id: 'scheduling',
          order: 40,
          labelKey: 'settings.sections.scheduling',
          legacyLabel: 'Scheduling',
        },
      ],
      legacySettingsPanels: [alwaysVisible, gated],
    }));
    vi.doMock('@/features/crm-firm', () => ({
      teamsRolesSettingsModule: {
        id: 'teams-roles',
        section: 'organization',
        order: 30,
        render: () => null,
      },
      customFieldsSettingsModule: {
        id: 'custom-fields-firm',
        section: 'organization',
        order: 20,
        flagId: 'custom-fields-firm',
        render: () => null,
      },
      contactSourcesSettingsPanel: {
        id: 'contact-sources',
        section: 'organization',
        order: 20,
        flagId: 'contact-sources',
        render: () => null,
      },
    }));
    vi.doMock('@/features/booking', async (importOriginal) => ({
      ...(await importOriginal<typeof import('@/features/booking')>()),
      bookingAvailabilitySettingsPanel: {
        id: 'booking-availability',
        section: 'scheduling',
        order: 100,
        flagId: 'booking-availability',
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
