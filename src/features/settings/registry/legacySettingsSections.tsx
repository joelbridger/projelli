import { BASE_SETTINGS_SCHEMA } from '@/platform/settings/schema';
import { renderRegisteredSettingsSection } from './sectionRendererBindings';
import type {
  SettingsPanelDescriptor,
  SettingsSectionDescriptor,
} from './types';

const definitionsFor = (section: string) => () =>
  BASE_SETTINGS_SCHEMA.filter((definition) =>
    section === 'ai'
      ? definition.category === 'ai-privacy'
      : definition.category === section
  );

/**
 * Compatibility descriptors for today's settings UI. Future features add one
 * descriptor beside their own panel rather than editing SettingsContent.
 */
const legacySectionRows = [
  {
    id: 'workspace',
    order: 10,
    labelKey: 'settings.sections.workspace',
    legacyLabel: 'Workspace',
    groups: [
      {
        id: 'ws-general',
        section: 'workspace',
        keywords: [
          'general',
          'language',
          'locale',
          'translation',
          'interface language',
          'app language',
          'english',
          'spanish',
          'startup',
          'update notification',
        ],
      },
      {
        id: 'ws-editor',
        section: 'workspace',
        keywords: [
          'editor',
          'font',
          'font size',
          'text size',
          'auto save',
          'auto-save',
          'autosave',
          'automatic save',
          'word wrap',
          'line numbers',
        ],
      },
      {
        id: 'ws-files',
        section: 'workspace',
        keywords: [
          'files',
          'workspace',
          'file type',
          'letterhead',
          'trash',
          'hidden files',
          'folder',
        ],
      },
    ],
  },
  {
    id: 'ai',
    order: 20,
    labelKey: 'settings.sections.ai',
    legacyLabel: 'AI',
    groups: [
      {
        id: 'aip-ai',
        section: 'ai',
        keywords: [
          'model',
          'models',
          'provider',
          'api key',
          'anthropic',
          'openai',
          'claude',
          'gpt',
          'gemini',
          'byok',
          'language model',
        ],
      },
      {
        id: 'aip-memory',
        section: 'ai',
        keywords: ['memory', 'facts', 'remember', 'context', 'recall'],
      },
    ],
  },
  {
    id: 'privacy',
    order: 30,
    labelKey: 'settings.sections.privacy',
    legacyLabel: 'Privacy',
    groups: [
      {
        id: 'privacy-core',
        section: 'privacy',
        keywords: [
          'privacy',
          'telemetry',
          'tracking',
          'analytics',
          'anonymous',
          'opt out',
          'confidential',
          'privileged',
          'egress',
          'network',
          'local only',
          'data map',
        ],
      },
      {
        id: 'privacy-recording',
        section: 'privacy',
        keywords: [
          'recording',
          'notice',
          'meeting',
          'consent',
          'strict',
          'spoken notice',
          'notice card',
        ],
      },
    ],
  },
  {
    id: 'scheduling',
    order: 40,
    labelKey: 'settings.sections.scheduling',
    legacyLabel: 'Scheduling',
    groups: [
      {
        id: 'scheduling-booking',
        section: 'scheduling',
        keywords: [
          'scheduling',
          'booking',
          'calendar link',
          'availability',
          'working hours',
          'meeting type',
          'buffer',
          'minimum notice',
          'timezone',
        ],
      },
    ],
  },
  {
    id: 'voice',
    order: 50,
    labelKey: 'settings.sections.voice',
    legacyLabel: 'Voice',
    groups: [
      {
        id: 'voice-input',
        section: 'voice',
        keywords: [
          'voice',
          'microphone',
          'speech to text',
          'dictation',
          'transcribe',
          'transcription',
          'push to talk',
        ],
      },
      {
        id: 'voice-tts',
        section: 'voice',
        keywords: [
          'voice',
          'text to speech',
          'read aloud',
          'narration',
          'pronunciation',
          'spoken language',
        ],
      },
    ],
  },
  {
    id: 'advanced',
    order: 60,
    labelKey: 'settings.sections.advanced',
    legacyLabel: 'Advanced',
    groups: [
      {
        id: 'adv-extensions',
        section: 'advanced',
        keywords: [
          'extension',
          'extensions',
          'plugin',
          'plugins',
          'marketplace',
          'integration',
          'integrations',
          'connector',
          'claude desktop',
          'template model',
          'add on',
          'addon',
        ],
      },
      {
        id: 'adv-updates',
        section: 'advanced',
        keywords: [
          'update',
          'updates',
          'version',
          'upgrade',
          'release',
          'new version',
        ],
      },
      {
        id: 'adv-advanced',
        section: 'advanced',
        keywords: [
          'advanced',
          'developer',
          'debug',
          'diagnostics',
          'reset',
          'experimental',
        ],
      },
    ],
  },
  {
    id: 'help',
    order: 70,
    labelKey: 'settings.sections.help',
    legacyLabel: 'Help',
    groups: [
      {
        id: 'adv-shortcuts',
        section: 'help',
        keywords: [
          'shortcut',
          'shortcuts',
          'keyboard',
          'hotkey',
          'hotkeys',
          'keybinding',
        ],
      },
      {
        id: 'adv-setup',
        section: 'help',
        keywords: [
          'setup',
          'onboarding',
          'tour',
          'guide',
          'tutorial',
          'getting started',
          'restart setup',
          'walkthrough',
        ],
      },
      {
        id: 'adv-about',
        section: 'help',
        keywords: ['about', 'legal', 'credits', 'licenses', 'acknowledgements'],
      },
    ],
  },
] as const;

export const legacySettingsSections: readonly SettingsSectionDescriptor[] =
  legacySectionRows.map((row) => ({
    ...row,
    definitions: definitionsFor(row.id),
  }));

export const legacySettingsPanels: readonly SettingsPanelDescriptor[] =
  legacySectionRows.map((row) => ({
    id: `legacy-${row.id}`,
    section: row.id,
    order: 10,
    render: (props) => renderRegisteredSettingsSection(row.id, props),
  }));
