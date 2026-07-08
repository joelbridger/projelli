// Extracted from SettingsContent.tsx — pure module-scope helpers and constants.
// No React, no JSX, no component state.

import type { SectionCategory } from '@/platform/settings/schema';

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
export const SETTINGS_GROUP_SEARCH: Record<string, { section: SectionCategory; keywords: string[] }> = {
  'ws-general':     { section: 'workspace',  keywords: ['general', 'language', 'locale', 'translation', 'interface language', 'app language', 'english', 'spanish', 'startup', 'update notification'] },
  'ws-editor':      { section: 'workspace',  keywords: ['editor', 'font', 'font size', 'text size', 'auto save', 'auto-save', 'autosave', 'automatic save', 'word wrap', 'line numbers'] },
  'ws-files':       { section: 'workspace',  keywords: ['files', 'workspace', 'file type', 'letterhead', 'trash', 'hidden files', 'folder'] },
  'aip-ai':         { section: 'ai',         keywords: ['model', 'models', 'provider', 'api key', 'anthropic', 'openai', 'claude', 'gpt', 'gemini', 'byok', 'language model'] },
  'aip-memory':     { section: 'ai',         keywords: ['memory', 'facts', 'remember', 'context', 'recall'] },
  'privacy-core':   { section: 'privacy',    keywords: ['privacy', 'telemetry', 'tracking', 'analytics', 'anonymous', 'opt out', 'confidential', 'privileged', 'egress', 'network', 'local only', 'data map'] },
  'privacy-recording': { section: 'privacy', keywords: ['recording', 'notice', 'meeting', 'consent', 'strict', 'spoken notice', 'notice card'] },
  'voice-input':    { section: 'voice',      keywords: ['voice', 'microphone', 'speech to text', 'dictation', 'transcribe', 'transcription', 'push to talk'] },
  'voice-tts':      { section: 'voice',      keywords: ['voice', 'text to speech', 'read aloud', 'narration', 'pronunciation', 'spoken language'] },
  'adv-extensions': { section: 'advanced',   keywords: ['extension', 'extensions', 'plugin', 'plugins', 'marketplace', 'integration', 'integrations', 'connector', 'claude desktop', 'template model', 'add on', 'addon'] },
  'adv-updates':    { section: 'advanced',   keywords: ['update', 'updates', 'version', 'upgrade', 'release', 'new version'] },
  'adv-advanced':   { section: 'advanced',   keywords: ['advanced', 'developer', 'debug', 'diagnostics', 'reset', 'experimental'] },
  'adv-shortcuts':  { section: 'help',       keywords: ['shortcut', 'shortcuts', 'keyboard', 'hotkey', 'hotkeys', 'keybinding'] },
  'adv-setup':      { section: 'help',       keywords: ['setup', 'onboarding', 'tour', 'guide', 'tutorial', 'getting started', 'restart setup', 'walkthrough'] },
  'adv-about':      { section: 'help',       keywords: ['about', 'legal', 'credits', 'licenses', 'acknowledgements'] },
};

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
export function groupKeywordMatch(subId: string, label: string, lowerQ: string): boolean {
  if (!lowerQ) return false;
  if (label.toLowerCase().includes(lowerQ)) return true;
  const entry = SETTINGS_GROUP_SEARCH[subId];
  return entry ? kwMatches(entry.keywords, lowerQ) : false;
}
