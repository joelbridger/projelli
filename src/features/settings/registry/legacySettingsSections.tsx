import { BASE_SETTINGS_SCHEMA } from '@/platform/settings/schema';
import { renderRegisteredSettingsSection } from './sectionRendererBindings';
import type { SettingsModuleDescriptor } from './types';

declare module './types' {
  interface SettingsSectionMap {
    workspace: true;
    ai: true;
    privacy: true;
    scheduling: true;
    voice: true;
    advanced: true;
    help: true;
  }
}

const definitionsFor = (section: string) =>
  () => BASE_SETTINGS_SCHEMA.filter((definition) =>
    section === 'ai'
      ? definition.category === 'ai-privacy'
      : definition.category === section,
  );

/**
 * Compatibility descriptors for today's settings UI. Future features add one
 * descriptor beside their own panel rather than editing SettingsContent.
 */
export const legacySettingsSections: readonly SettingsModuleDescriptor[] = [
  { id: 'workspace', order: 10, labelKey: 'settings.sections.workspace', legacyLabel: 'Workspace', definitions: definitionsFor('workspace'), groups: [{ id: 'ws-general', section: 'workspace', keywords: ['general', 'language', 'locale', 'translation', 'interface language', 'app language', 'english', 'spanish', 'startup', 'update notification'] }, { id: 'ws-editor', section: 'workspace', keywords: ['editor', 'font', 'font size', 'text size', 'auto save', 'auto-save', 'autosave', 'automatic save', 'word wrap', 'line numbers'] }, { id: 'ws-files', section: 'workspace', keywords: ['files', 'workspace', 'file type', 'letterhead', 'trash', 'hidden files', 'folder'] }], render: (props) => renderRegisteredSettingsSection('workspace', props) },
  { id: 'ai', order: 20, labelKey: 'settings.sections.ai', legacyLabel: 'AI', definitions: definitionsFor('ai'), groups: [{ id: 'aip-ai', section: 'ai', keywords: ['model', 'models', 'provider', 'api key', 'anthropic', 'openai', 'claude', 'gpt', 'gemini', 'byok', 'language model'] }, { id: 'aip-memory', section: 'ai', keywords: ['memory', 'facts', 'remember', 'context', 'recall'] }], render: (props) => renderRegisteredSettingsSection('ai', props) },
  { id: 'privacy', order: 30, labelKey: 'settings.sections.privacy', legacyLabel: 'Privacy', definitions: definitionsFor('privacy'), groups: [{ id: 'privacy-core', section: 'privacy', keywords: ['privacy', 'telemetry', 'tracking', 'analytics', 'anonymous', 'opt out', 'confidential', 'privileged', 'egress', 'network', 'local only', 'data map'] }, { id: 'privacy-recording', section: 'privacy', keywords: ['recording', 'notice', 'meeting', 'consent', 'strict', 'spoken notice', 'notice card'] }], render: (props) => renderRegisteredSettingsSection('privacy', props) },
  { id: 'scheduling', order: 40, labelKey: 'settings.sections.scheduling', legacyLabel: 'Scheduling', definitions: definitionsFor('scheduling'), groups: [{ id: 'scheduling-booking', section: 'scheduling', keywords: ['scheduling', 'booking', 'calendar link', 'availability', 'working hours', 'meeting type', 'buffer', 'minimum notice', 'timezone'] }], render: (props) => renderRegisteredSettingsSection('scheduling', props) },
  { id: 'voice', order: 50, labelKey: 'settings.sections.voice', legacyLabel: 'Voice', definitions: definitionsFor('voice'), groups: [{ id: 'voice-input', section: 'voice', keywords: ['voice', 'microphone', 'speech to text', 'dictation', 'transcribe', 'transcription', 'push to talk'] }, { id: 'voice-tts', section: 'voice', keywords: ['voice', 'text to speech', 'read aloud', 'narration', 'pronunciation', 'spoken language'] }], render: (props) => renderRegisteredSettingsSection('voice', props) },
  { id: 'advanced', order: 60, labelKey: 'settings.sections.advanced', legacyLabel: 'Advanced', definitions: definitionsFor('advanced'), groups: [{ id: 'adv-extensions', section: 'advanced', keywords: ['extension', 'extensions', 'plugin', 'plugins', 'marketplace', 'integration', 'integrations', 'connector', 'claude desktop', 'template model', 'add on', 'addon'] }, { id: 'adv-updates', section: 'advanced', keywords: ['update', 'updates', 'version', 'upgrade', 'release', 'new version'] }, { id: 'adv-advanced', section: 'advanced', keywords: ['advanced', 'developer', 'debug', 'diagnostics', 'reset', 'experimental'] }], render: (props) => renderRegisteredSettingsSection('advanced', props) },
  { id: 'help', order: 70, labelKey: 'settings.sections.help', legacyLabel: 'Help', definitions: definitionsFor('help'), groups: [{ id: 'adv-shortcuts', section: 'help', keywords: ['shortcut', 'shortcuts', 'keyboard', 'hotkey', 'hotkeys', 'keybinding'] }, { id: 'adv-setup', section: 'help', keywords: ['setup', 'onboarding', 'tour', 'guide', 'tutorial', 'getting started', 'restart setup', 'walkthrough'] }, { id: 'adv-about', section: 'help', keywords: ['about', 'legal', 'credits', 'licenses', 'acknowledgements'] }], render: (props) => renderRegisteredSettingsSection('help', props) },
];
