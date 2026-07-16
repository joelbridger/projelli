import {
  SETTINGS_SCHEMA,
  resolveSection,
  type SectionCategory,
} from '@/platform/settings/schema';
import { SHORTCUTS } from '@/platform/utils/shortcuts';
import {
  getSettingsGroupSearch,
  groupKeywordMatch,
  SETTING_SEARCH_ALIASES,
} from './settingsContentHelpers';
import {
  getSettingsSearchSectionDescriptors,
  getSettingsSectionSearchTerms,
  getVisibleSettingsSectionDescriptors,
} from './registry/settingsModuleRegistry';
import type { SettingsSectionDescriptor } from './registry/types';

const HIDDEN_SETTING_KEYS = new Set(['tabOverflow']);

function isVisibleSettingKey(key: string): boolean {
  return !HIDDEN_SETTING_KEYS.has(key);
}

function settingMatchesQuery(
  definition: (typeof SETTINGS_SCHEMA)[number],
  lowerQuery: string,
): boolean {
  if (!lowerQuery) return true;
  if (definition.label.toLowerCase().includes(lowerQuery)) return true;
  if (definition.description.toLowerCase().includes(lowerQuery)) return true;
  if (definition.key.toLowerCase().includes(lowerQuery)) return true;
  if (definition.options?.some((option) => option.label.toLowerCase().includes(lowerQuery))) {
    return true;
  }
  return (SETTING_SEARCH_ALIASES[definition.key] ?? []).some(
    (term) => term.includes(lowerQuery) || lowerQuery.includes(term),
  );
}

export interface SettingsSearchResults {
  filteredKeys: Set<string>;
  sectionScores: Record<SectionCategory, number>;
  visibleSectionIds: Set<SectionCategory>;
}

/**
 * The one Settings search contract shared by the legacy surface and v1 frame.
 * It deliberately indexes schema labels, descriptions, keys, option labels,
 * aliases, group keywords, registered-section terms, and shortcut metadata.
 */
export function getSettingsSearchResults(
  query: string,
  registeredSections: readonly SettingsSectionDescriptor[] = getVisibleSettingsSectionDescriptors(),
): SettingsSearchResults {
  const lowerQuery = query.toLowerCase().trim();
  const filteredKeys = new Set(
    SETTINGS_SCHEMA
      .filter(
        (definition) =>
          isVisibleSettingKey(definition.key) && settingMatchesQuery(definition, lowerQuery),
      )
      .map((definition) => definition.key),
  );
  const sectionScores = Object.fromEntries(
    getSettingsSearchSectionDescriptors().map((section) => [section.id, 0]),
  ) as Record<SectionCategory, number>;

  if (!lowerQuery) {
    return {
      filteredKeys,
      sectionScores,
      visibleSectionIds: new Set(registeredSections.map((section) => section.id)),
    };
  }

  const bump = (section: SectionCategory, score: number) => {
    if (section in sectionScores && score > sectionScores[section]) {
      sectionScores[section] = score;
    }
  };
  for (const definition of SETTINGS_SCHEMA) {
    if (!isVisibleSettingKey(definition.key)) continue;
    const section = resolveSection(definition.category);
    const aliasHit = (SETTING_SEARCH_ALIASES[definition.key] ?? []).some(
      (term) => term.includes(lowerQuery) || lowerQuery.includes(term),
    );
    const optionHit = definition.options?.some((option) =>
      option.label.toLowerCase().includes(lowerQuery),
    ) ?? false;
    if (definition.label.toLowerCase().includes(lowerQuery) || aliasHit || optionHit) {
      bump(section, 3);
    } else if (definition.key.toLowerCase().includes(lowerQuery)) {
      bump(section, 2);
    } else if (definition.description.toLowerCase().includes(lowerQuery)) {
      bump(section, 1);
    }
  }
  const groupSearch = getSettingsGroupSearch();
  for (const [subsectionId, entry] of Object.entries(groupSearch)) {
    if (groupKeywordMatch(subsectionId, '', lowerQuery, groupSearch)) {
      bump(entry.section, 3);
    }
  }
  for (const section of registeredSections) {
    if (getSettingsSectionSearchTerms(section.id).some(
      (term) => term.includes(lowerQuery) || lowerQuery.includes(term),
    )) {
      bump(section.id, 3);
    }
  }
  const shortcutHit = SHORTCUTS.some(
    (shortcut) =>
      shortcut.label.toLowerCase().includes(lowerQuery) ||
      (shortcut.description ?? '').toLowerCase().includes(lowerQuery) ||
      shortcut.keys.some((key) => key.toLowerCase().includes(lowerQuery)),
  );
  if (shortcutHit) bump('help', 2);

  return {
    filteredKeys,
    sectionScores,
    visibleSectionIds: new Set(
      (Object.keys(sectionScores) as SectionCategory[]).filter(
        (section) => sectionScores[section] > 0,
      ),
    ),
  };
}
