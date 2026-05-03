/**
 * Settings Schema — Single source of truth for every user-configurable setting.
 *
 * The Settings modal renders FROM this schema. Adding a new setting later
 * means adding one entry to `SETTINGS_SCHEMA` — no component changes needed.
 *
 * Categories map 1:1 to the sidebar nav in the Settings modal.
 */

export type SettingType = 'toggle' | 'select' | 'number' | 'text' | 'shortcut-display';

export type SettingCategory =
  | 'general'
  | 'license'
  | 'editor'
  | 'ai'
  | 'memory'
  | 'voice'
  | 'files'
  | 'shortcuts'
  | 'costs'
  | 'templates'
  | 'integrations'
  | 'marketplace'
  | 'plugins'
  | 'mobile'
  | 'advanced'
  | 'updates'
  | 'onboarding'
  | 'privacy'
  | 'about';

export interface SettingOption {
  value: string;
  label: string;
}

export interface SettingAction {
  label: string;
  actionId: string;
}

export interface SettingDefinition {
  key: string;
  category: SettingCategory;
  label: string;
  description: string;
  type: SettingType;
  defaultValue: unknown;
  options?: SettingOption[];       // for 'select'
  min?: number;                   // for 'number'
  max?: number;
  step?: number;
  /** For action-link entries (e.g., "Manage API Keys" opens the AI panel). */
  action?: SettingAction;
}

export const SETTING_CATEGORIES: { id: SettingCategory; label: string }[] = [
  { id: 'general', label: 'General' },
  { id: 'license', label: 'License' },
  { id: 'editor', label: 'Editor' },
  { id: 'ai', label: 'AI' },
  { id: 'memory', label: 'Memory' },
  { id: 'voice', label: 'Voice' },
  { id: 'files', label: 'Files & Workspace' },
  { id: 'shortcuts', label: 'Keyboard Shortcuts' },
  { id: 'costs', label: 'Cost & Usage' },
  { id: 'templates', label: 'Templates' },
  { id: 'integrations', label: 'Integrations' },
  { id: 'marketplace', label: 'Marketplace' },
  { id: 'plugins', label: 'Plugins' },
  { id: 'mobile', label: 'Mobile' },
  { id: 'advanced', label: 'Advanced' },
  { id: 'updates', label: 'Updates' },
  { id: 'onboarding', label: 'Onboarding' },
  { id: 'privacy', label: 'Privacy' },
  { id: 'about', label: 'About' },
];

export const SETTINGS_SCHEMA: SettingDefinition[] = [
  // ── General ───────────────────────────────────────────────────────────
  {
    key: 'theme',
    category: 'general',
    label: 'Theme',
    description: 'Choose light, dark, or follow your system preference.',
    type: 'select',
    defaultValue: 'system',
    options: [
      { value: 'system', label: 'System' },
      { value: 'light', label: 'Light' },
      { value: 'dark', label: 'Dark' },
    ],
  },
  {
    key: 'startupBehavior',
    category: 'general',
    label: 'On Startup',
    description: 'What happens when you launch Projelli.',
    type: 'select',
    defaultValue: 'reopen',
    options: [
      { value: 'reopen', label: 'Reopen last workspace' },
      { value: 'selector', label: 'Show workspace selector' },
    ],
  },
  {
    key: 'showWhatsNew',
    category: 'general',
    label: 'Show Update Notifications',
    description: 'Display a toast when a new version of Projelli is available.',
    type: 'toggle',
    defaultValue: true,
  },

  // ── Editor ────────────────────────────────────────────────────────────
  {
    key: 'tabOverflow',
    category: 'editor',
    label: 'Tab Overflow',
    description: 'How tabs behave when they exceed the available width.',
    type: 'select',
    defaultValue: 'scroll',
    options: [
      { value: 'scroll', label: 'Scroll horizontally' },
      { value: 'wrap', label: 'Wrap to multiple rows' },
    ],
  },
  {
    key: 'fontSize',
    category: 'editor',
    label: 'Font Size',
    description: 'Base font size for text editors (px).',
    type: 'number',
    defaultValue: 14,
    min: 12,
    max: 24,
    step: 1,
  },
  {
    key: 'autoSave',
    category: 'editor',
    label: 'Auto Save',
    description: 'Automatically save files after changes.',
    type: 'toggle',
    defaultValue: true,
  },
  {
    key: 'autoSaveInterval',
    category: 'editor',
    label: 'Auto Save Interval',
    description: 'Seconds between auto-saves (when enabled).',
    type: 'number',
    defaultValue: 2,
    min: 1,
    max: 30,
    step: 1,
  },
  {
    key: 'wordWrap',
    category: 'editor',
    label: 'Word Wrap',
    description: 'Wrap long lines instead of scrolling horizontally.',
    type: 'toggle',
    defaultValue: true,
  },
  {
    key: 'lineNumbers',
    category: 'editor',
    label: 'Line Numbers',
    description: 'Show line numbers in text editors.',
    type: 'toggle',
    defaultValue: true,
  },

  // ── AI ────────────────────────────────────────────────────────────────
  {
    key: 'ambientFileContext',
    category: 'ai',
    label: 'Ambient File Context',
    description: 'Automatically share open files with AI chat.',
    type: 'toggle',
    defaultValue: true,
  },
  {
    key: 'ambientContextTokenLimit',
    category: 'ai',
    label: 'Context Token Limit',
    description: 'Max tokens included from open files in AI prompts.',
    type: 'number',
    defaultValue: 50000,
    min: 10000,
    max: 200000,
    step: 5000,
  },
  {
    key: 'manageApiKeys',
    category: 'ai',
    label: 'API Keys',
    description: 'Add or remove API keys for AI providers.',
    type: 'text', // rendered as action link
    defaultValue: '',
    action: { label: 'Manage API Keys', actionId: 'open-ai-keys' },
  },
  {
    key: 'manageAIRules',
    category: 'ai',
    label: 'AI Rules',
    description: 'Customize how AI behaves in this workspace.',
    type: 'text', // rendered as action link
    defaultValue: '',
    action: { label: 'Manage AI Rules', actionId: 'open-ai-rules' },
  },

  // ── Memory ────────────────────────────────────────────────────────────
  {
    key: 'memoryEnabled',
    category: 'memory',
    label: 'Workspace memory',
    description:
      'Index your workspace files locally so AI can recall relevant context. Embeddings live on your machine, nothing is sent anywhere.',
    type: 'toggle',
    defaultValue: true,
  },
  {
    key: 'factsInjection',
    category: 'memory',
    label: 'Inject memory facts into chat',
    description:
      'Prepend your saved memory facts to every chat system prompt so the AI always knows prior durable context. Turn off if you want workspace memory without the facts block.',
    type: 'toggle',
    defaultValue: true,
  },
  {
    key: 'factsAutoAccept',
    category: 'memory',
    label: 'Auto-accept proposed facts',
    description:
      'When enabled, facts that the AI extracts from your conversations are saved without asking. Default is off, so every proposed fact needs your approval.',
    type: 'toggle',
    defaultValue: false,
  },

  // ── Voice ─────────────────────────────────────────────────────────────
  {
    key: 'voiceEnabled',
    category: 'voice',
    label: 'Voice input',
    description:
      'Hold Ctrl+Shift+Space (Cmd+Shift+Space on Mac) to talk; release to transcribe and insert at the cursor. Runs a bundled speech-recognition binary on your machine — no network, no API key.',
    type: 'toggle',
    defaultValue: true,
  },
  {
    key: 'voiceModel',
    category: 'voice',
    label: 'Transcription model',
    description:
      'Smaller models are faster but less accurate. Changes take effect on the next transcription.',
    type: 'select',
    defaultValue: 'small',
    options: [
      { value: 'tiny', label: 'Tiny (fastest)' },
      { value: 'base', label: 'Base' },
      { value: 'small', label: 'Small (recommended)' },
    ],
  },
  {
    key: 'voicePressToTalkShortcut',
    category: 'voice',
    label: 'Press-to-talk hotkey',
    description:
      'Hold this shortcut to record; release to transcribe. Customization is coming in a later release.',
    type: 'shortcut-display',
    defaultValue: 'Ctrl+Shift+Space',
  },
  {
    key: 'voiceNoteShortcut',
    category: 'voice',
    label: 'Voice-to-note hotkey',
    description:
      'Record a voice note and save the transcription to Inbox/ as a new Markdown file. Release to save.',
    type: 'shortcut-display',
    defaultValue: 'Ctrl+Shift+N',
  },

  // ── Files & Workspace ─────────────────────────────────────────────────
  {
    key: 'defaultNewFileType',
    category: 'files',
    label: 'Default New File Type',
    description: 'File format used when creating a new file from the toolbar.',
    type: 'select',
    defaultValue: 'markdown',
    options: [
      { value: 'markdown', label: 'Markdown' },
      { value: 'plaintext', label: 'Plain Text' },
      { value: 'richtext', label: 'Rich Text' },
    ],
  },
  {
    key: 'trashRetention',
    category: 'files',
    label: 'Trash Retention',
    description: 'How long deleted files are kept before permanent removal.',
    type: 'select',
    defaultValue: '30',
    options: [
      { value: '7', label: '7 days' },
      { value: '14', label: '14 days' },
      { value: '30', label: '30 days' },
      { value: '90', label: '90 days' },
      { value: 'never', label: 'Never (keep forever)' },
    ],
  },
  {
    key: 'showHiddenFiles',
    category: 'files',
    label: 'Show Hidden Files',
    description: 'Display files and folders that start with a dot (e.g., .gitignore).',
    type: 'toggle',
    defaultValue: false,
  },

  // ── Updates ───────────────────────────────────────────────────────────
  {
    key: 'autoUpdateCheck',
    category: 'updates',
    label: 'Check for updates automatically',
    description: 'When enabled, Projelli checks GitHub Releases for new versions in the background and prompts you when one is available.',
    type: 'toggle',
    defaultValue: true,
  },
  {
    key: 'updateChannel',
    category: 'updates',
    label: 'Update channel',
    description: 'Which release channel to follow. Beta is reserved for future use.',
    type: 'select',
    defaultValue: 'stable',
    options: [
      { value: 'stable', label: 'Stable' },
    ],
  },
  {
    key: 'manualCheckNow',
    category: 'updates',
    label: 'Check for updates now',
    description: 'Run the updater check immediately without waiting for the scheduled interval.',
    type: 'text', // rendered as action link
    defaultValue: '',
    action: { label: 'Check now', actionId: 'updater-check-now' },
  },

  // ── Onboarding ────────────────────────────────────────────────────────
  {
    key: 'viewApiKeyTutorial',
    category: 'onboarding',
    label: 'API Key Tutorial',
    description: 'Step-by-step guide to get an API key from Anthropic, OpenAI, or Google.',
    type: 'text',
    defaultValue: '',
    action: { label: 'View guide', actionId: 'open-api-key-tutorial' },
  },
  {
    key: 'resetFeatureTour',
    category: 'onboarding',
    label: 'Feature Tour',
    description: 'Replay the 10-step tour that introduces the Projelli workspace.',
    type: 'text',
    defaultValue: '',
    action: { label: 'Start tour', actionId: 'reset-feature-tour' },
  },

  // ── About ─────────────────────────────────────────────────────────────
  {
    key: 'aboutWhatsNew',
    category: 'about',
    label: "What's new",
    description: 'See highlights from the most recent Projelli releases.',
    type: 'text',
    defaultValue: '',
    action: { label: "What's new", actionId: 'open-whats-new' },
  },
  {
    key: 'aboutWebsite',
    category: 'about',
    label: 'Website',
    description: 'Open projelli.com in your browser.',
    type: 'text',
    defaultValue: '',
    action: { label: 'Open website', actionId: 'open-website' },
  },
  {
    key: 'aboutGithub',
    category: 'about',
    label: 'GitHub',
    description: 'Browse the source, file an issue, or contribute on GitHub.',
    type: 'text',
    defaultValue: '',
    action: { label: 'Open GitHub', actionId: 'open-github' },
  },
];

/**
 * Build a map of key -> defaultValue from the schema.
 */
export function getSchemaDefaults(): Record<string, unknown> {
  const defaults: Record<string, unknown> = {};
  for (const def of SETTINGS_SCHEMA) {
    defaults[def.key] = def.defaultValue;
  }
  return defaults;
}

/**
 * Look up a SettingDefinition by key.
 */
export function getSettingDef(key: string): SettingDefinition | undefined {
  return SETTINGS_SCHEMA.find((d) => d.key === key);
}
