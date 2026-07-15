import { legacySettingsSections } from './legacySettingsSections';
import { BASE_SETTINGS_SCHEMA } from '@/platform/settings/schema';
import { isEnabled } from '@/platform/flags/router';
import { teamsRolesSettingsModule } from '@/features/crm-firm/teams-roles';
import type { SettingsGroupDescriptor, SettingsModuleDescriptor } from './types';

/** The append-only mount list for feature-owned settings sections. */
export const settingsModuleRegistry: readonly SettingsModuleDescriptor[] = [...legacySettingsSections, ...(isEnabled('teams-roles') ? [teamsRolesSettingsModule] : [])];

export function validateSettingsModuleDescriptors(
  descriptors: readonly SettingsModuleDescriptor[],
): void {
  const ids = new Set<string>();
  const groupIds = new Set<string>();
  const definitionKeys = new Set<string>();

  for (const descriptor of descriptors) {
    if (ids.has(descriptor.id)) {
      throw new Error(`[settingsModuleRegistry] duplicate section id: ${descriptor.id}`);
    }
    ids.add(descriptor.id);

    if (!descriptor.labelKey.includes('.')) {
      throw new Error(`[settingsModuleRegistry] labelKey must include a namespace: ${descriptor.id}`);
    }

    for (const group of descriptor.groups ?? []) {
      if (group.section !== descriptor.id) {
        throw new Error(`[settingsModuleRegistry] group belongs to another section: ${group.id}`);
      }
      if (groupIds.has(group.id)) {
        throw new Error(`[settingsModuleRegistry] duplicate group id: ${group.id}`);
      }
      groupIds.add(group.id);
    }

    const definitions = typeof descriptor.definitions === 'function'
      ? descriptor.definitions()
      : (descriptor.definitions ?? []);
    for (const definition of definitions) {
      if (definitionKeys.has(definition.key)) {
        throw new Error(`[settingsModuleRegistry] duplicate setting key: ${definition.key}`);
      }
      definitionKeys.add(definition.key);
    }
  }
}

function ordered(): readonly SettingsModuleDescriptor[] {
  return settingsModuleRegistry.slice().sort((a, b) => a.order - b.order);
}

export function getSettingsModuleDescriptors(): readonly SettingsModuleDescriptor[] {
  validateSettingsModuleDescriptors(settingsModuleRegistry);
  return ordered();
}

export function getSettingsModuleDescriptor(id: string): SettingsModuleDescriptor | undefined {
  return settingsModuleRegistry.find((descriptor) => descriptor.id === id);
}

export function getSettingsModuleDefinitions() {
  const registeredDefinitions = ordered().flatMap((descriptor) => {
    const definitions = descriptor.definitions;
    return typeof definitions === 'function' ? definitions() : (definitions ?? []);
  });

  const definitionByKey = new Map(registeredDefinitions.map((definition) => [definition.key, definition]));
  const baseKeys = new Set(BASE_SETTINGS_SCHEMA.map((definition) => definition.key));

  // The UI registry may group sections in rail order, but the flattened schema
  // keeps the authored platform order. Settings export serializes this order.
  return [
    ...BASE_SETTINGS_SCHEMA.flatMap((definition) => {
      const registered = definitionByKey.get(definition.key);
      return registered ? [registered] : [];
    }),
    ...registeredDefinitions.filter((definition) => !baseKeys.has(definition.key)),
  ];
}

export function getSettingsGroupDescriptors(): readonly SettingsGroupDescriptor[] {
  return ordered().flatMap((descriptor) => descriptor.groups ?? []);
}
