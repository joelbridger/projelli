import {
  legacySettingsPanels,
  legacySettingsSections,
} from './legacySettingsSections';
import { BASE_SETTINGS_SCHEMA } from '@/platform/settings/schema';
import { isEnabled } from '@/platform/flags/router';
import { teamsRolesSettingsModule } from '@/features/crm-firm';
import { customFieldsSettingsModule } from '@/features/crm-firm/custom-fields';
import type {
  SettingsGroupDescriptor,
  SettingsPanelDescriptor,
  SettingsSectionDescriptor,
} from './types';

/**
 * Append-only rail-section mount point. A section is known to the registry
 * even when all of its panels are dark; it only appears in the UI once a
 * visible panel mounts into it.
 */
export const settingsSectionRegistry: readonly SettingsSectionDescriptor[] = [
  ...legacySettingsSections,
  {
    id: 'organization',
    order: 80,
    labelKey: 'teams-roles.settings-label',
    legacyLabel: 'Organization',
  },
];

/**
 * Append-only feature-panel mount point. Feature lanes add exactly one line
 * here for an existing section. A lane introducing a new section makes two
 * append-only changes in this file: one section entry above and one panel here.
 */
export const settingsPanelRegistry: readonly SettingsPanelDescriptor[] = [
  ...legacySettingsPanels,
  teamsRolesSettingsModule,
  customFieldsSettingsModule,
];

function definitionsFor(
  descriptor: Pick<
    SettingsSectionDescriptor | SettingsPanelDescriptor,
    'definitions'
  >
) {
  return typeof descriptor.definitions === 'function'
    ? descriptor.definitions()
    : (descriptor.definitions ?? []);
}

function validateGroups(
  section: string,
  groups: readonly SettingsGroupDescriptor[] | undefined,
  groupIds: Set<string>
): void {
  for (const group of groups ?? []) {
    if (group.section !== section) {
      throw new Error(
        `[settingsModuleRegistry] group belongs to another section: ${group.id}`
      );
    }
    if (groupIds.has(group.id)) {
      throw new Error(
        `[settingsModuleRegistry] duplicate group id: ${group.id}`
      );
    }
    groupIds.add(group.id);
  }
}

/** Reject malformed registry mounts before the UI consumes them. */
export function validateSettingsModuleDescriptors(
  sections: readonly SettingsSectionDescriptor[],
  panels: readonly SettingsPanelDescriptor[] = settingsPanelRegistry
): void {
  const sectionIds = new Set<string>();
  const panelIds = new Set<string>();
  const groupIds = new Set<string>();
  const definitionKeys = new Set<string>();

  const validateDefinitions = (
    descriptor: Pick<
      SettingsSectionDescriptor | SettingsPanelDescriptor,
      'definitions'
    >
  ) => {
    for (const definition of definitionsFor(descriptor)) {
      if (definitionKeys.has(definition.key)) {
        throw new Error(
          `[settingsModuleRegistry] duplicate setting key: ${definition.key}`
        );
      }
      definitionKeys.add(definition.key);
    }
  };

  for (const section of sections) {
    if ('render' in section || 'section' in section || 'flagId' in section) {
      throw new Error(
        `[settingsModuleRegistry] panel-shaped object in section list: ${section.id}`
      );
    }
    if (sectionIds.has(section.id)) {
      throw new Error(
        `[settingsModuleRegistry] duplicate section id: ${section.id}`
      );
    }
    sectionIds.add(section.id);
    if (!section.labelKey.includes('.')) {
      throw new Error(
        `[settingsModuleRegistry] labelKey must include a namespace: ${section.id}`
      );
    }
    validateGroups(section.id, section.groups, groupIds);
    validateDefinitions(section);
  }

  for (const panel of panels) {
    if (panelIds.has(panel.id)) {
      throw new Error(
        `[settingsModuleRegistry] duplicate panel id: ${panel.id}`
      );
    }
    panelIds.add(panel.id);
    if (!sectionIds.has(panel.section)) {
      throw new Error(
        `[settingsModuleRegistry] panel belongs to an unknown section: ${panel.id}`
      );
    }
    if (panel.labelKey && !panel.labelKey.includes('.')) {
      throw new Error(
        `[settingsModuleRegistry] labelKey must include a namespace: ${panel.id}`
      );
    }
    validateGroups(panel.section, panel.groups, groupIds);
    validateDefinitions(panel);
  }
}

function ordered<T extends { order: number }>(
  descriptors: readonly T[]
): readonly T[] {
  return descriptors.slice().sort((a, b) => a.order - b.order);
}

function panelIsVisible(panel: SettingsPanelDescriptor): boolean {
  return panel.flagId === undefined || isEnabled(panel.flagId);
}

export function getSettingsSectionDescriptors(): readonly SettingsSectionDescriptor[] {
  validateSettingsModuleDescriptors(settingsSectionRegistry);
  return ordered(settingsSectionRegistry);
}

/** All registered sections are the stable search-scoring vocabulary. */
export function getSettingsSearchSectionDescriptors(): readonly SettingsSectionDescriptor[] {
  return getSettingsSectionDescriptors();
}

/** Sections that have at least one visible panel, in stable rail order. */
export function getVisibleSettingsSectionDescriptors(): readonly SettingsSectionDescriptor[] {
  const visiblePanelSections = new Set(
    getSettingsPanelDescriptors().map((panel) => panel.section)
  );
  return getSettingsSectionDescriptors().filter((section) =>
    visiblePanelSections.has(section.id)
  );
}

export function getSettingsPanelDescriptors(
  section?: string
): readonly SettingsPanelDescriptor[] {
  validateSettingsModuleDescriptors(settingsSectionRegistry);
  return ordered(settingsPanelRegistry).filter(
    (panel) =>
      (section === undefined || panel.section === section) &&
      panelIsVisible(panel)
  );
}

export function getSettingsModuleDefinitions() {
  const registeredDefinitions = [
    ...getSettingsSectionDescriptors().flatMap(definitionsFor),
    ...getSettingsPanelDescriptors().flatMap(definitionsFor),
  ];
  const definitionByKey = new Map(
    registeredDefinitions.map((definition) => [definition.key, definition])
  );
  const baseKeys = new Set(
    BASE_SETTINGS_SCHEMA.map((definition) => definition.key)
  );

  return [
    ...BASE_SETTINGS_SCHEMA.flatMap((definition) => {
      const registered = definitionByKey.get(definition.key);
      return registered ? [registered] : [];
    }),
    ...registeredDefinitions.filter(
      (definition) => !baseKeys.has(definition.key)
    ),
  ];
}

export function getSettingsGroupDescriptors(): readonly SettingsGroupDescriptor[] {
  return [
    ...getSettingsSectionDescriptors().flatMap(
      (section) => section.groups ?? []
    ),
    ...getSettingsPanelDescriptors().flatMap((panel) => panel.groups ?? []),
  ];
}

export function getSettingsSectionSearchTerms(
  section: string
): readonly string[] {
  const sectionTerms =
    getSettingsSectionDescriptors().find((item) => item.id === section)
      ?.searchTerms ?? [];
  const panelTerms = getSettingsPanelDescriptors(section).flatMap(
    (panel) => panel.searchTerms ?? []
  );
  return [...sectionTerms, ...panelTerms];
}
