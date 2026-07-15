// Extracted from SettingsContent.tsx — pure module-scope helpers and constants.
// No React, no JSX, no component state.

import type { SectionCategory } from '@/platform/settings/schema';
import { getSettingsGroupDescriptors } from './registry/settingsModuleRegistry';

/** Map a SETTINGS_SCHEMA `key` to the kebab-case test id callers know
 *  about. Keeps test selectors stable when refactoring. */
export function settingTestid(key: string): string | undefined {
  switch (key) {
    case 'memoryEnabled':
      return 'settings-memory-enabled';
    case 'factsInjection':
      return 'settings-facts-inject-toggle';
    case 'factsAutoAccept':
      return 'settings-facts-auto-accept-toggle';
    default:
      return undefined;
  }
}

// ---------------------------------------------------------------------------
// Search index
// ---------------------------------------------------------------------------

/**
 * Search keywords per accordion sub-section, so the cross-section search finds
 * things that aren't plain SETTINGS_SCHEMA fields — the bespoke controls
 * (LanguagePicker, MarketplaceTab, the setup/tour links, etc.).
 * Without this, searching "language" misses the General language
 * picker and the Extensions/templates group entirely. The key is the SubSection
 * `id`; `section` is the top-level category the group lives in.
 */
export function getSettingsGroupSearch(): Record<
  string,
  { section: SectionCategory; keywords: string[] }
> {
  return Object.fromEntries(
    getSettingsGroupDescriptors().map((group) => [
      group.id,
      { section: group.section, keywords: [...group.keywords] },
    ])
  );
}

export const SETTING_SEARCH_ALIASES: Record<string, string[]> = {
  autoSave: ['auto save', 'auto-save', 'automatic save', 'save automatically'],
  autoSaveInterval: ['auto save delay', 'auto-save delay', 'autosave delay', 'save delay', 'save interval'],
};

/**
 * Keyword match. Forward (keyword contains the query) handles partial typing
 * ("plug" -> "plugin"). The reverse (query contains the keyword) is gated to
 * keywords >= 4 chars so a short token like "ai" never matches inside "email".
 */
export function kwMatches(keywords: string[], lowerQ: string): boolean {
  if (!lowerQ) return false;
  return keywords.some((k) => k.includes(lowerQ) || (k.length >= 4 && lowerQ.includes(k)));
}

/** True when a sub-section's own keywords or label match the query. */
export function groupKeywordMatch(
  subId: string,
  label: string,
  lowerQ: string,
  groupSearch = getSettingsGroupSearch()
): boolean {
  if (!lowerQ) return false;
  if (label.toLowerCase().includes(lowerQ)) return true;
  const entry = groupSearch[subId];
  return entry ? kwMatches(entry.keywords, lowerQ) : false;
}
