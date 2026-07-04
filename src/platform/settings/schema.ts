/**
 * Settings Schema — Single source of truth for every user-configurable setting.
 *
 * The Settings modal renders FROM this schema. Adding a new setting later
 * means adding one entry to `SETTINGS_SCHEMA` — no component changes needed.
 *
 * v3.2 — 20 flat categories collapsed into 5 elegant sections:
 *   workspace   | AI & Privacy   | Voice   | Advanced   | Help
 *
 * Account content (License, Firm, Usage, Connections) moved to a dedicated
 * AccountWindow and is no longer a Settings section.
 *
 * Legacy category ids (general, editor, files, ai, memory, privacy, license,
 * firm, costs, integrations, voice, shortcuts, marketplace, plugins, templates,
 * updates, mobile, onboarding, advanced, about) are kept as aliases in the
 * SettingCategory union so that existing deep-link call sites continue to
 * compile.  The CATEGORY_ALIAS_MAP in SettingsModal resolves them at runtime.
 */

export type SettingType = 'toggle' | 'select' | 'number' | 'text' | 'shortcut-display';

/** The 5 canonical section ids used in the sidebar nav. */
export type SectionCategory = 'workspace' | 'ai-privacy' | 'voice' | 'advanced' | 'help';

/**
 * SettingCategory includes both the 5 new section ids AND every legacy id so
 * that callers that pass e.g. `initialCategory="ai"` still type-check.
 * 'account' is kept as a legacy alias (deep-links are intercepted in App.tsx
 * and redirected to the AccountWindow before Settings ever sees them).
 */
export type SettingCategory =
  // ── 5 canonical sections ──────────────────────────────────────────────
  | 'workspace'
  | 'ai-privacy'
  | 'voice'
  | 'advanced'
  | 'help'
  // ── legacy aliases (kept for deep-link compatibility) ─────────────────
  | 'account'
  | 'general'
  | 'license'
  | 'firm'
  | 'editor'
  | 'ai'
  | 'memory'
  | 'files'
  | 'shortcuts'
  | 'costs'
  | 'templates'
  | 'integrations'
  | 'marketplace'
  | 'mobile'
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

/** The 5 nav sections shown in the sidebar. */
export const SETTING_CATEGORIES: { id: SectionCategory; label: string }[] = [
  { id: 'workspace',   label: 'Workspace' },
  { id: 'ai-privacy', label: 'AI & Privacy' },
  { id: 'voice',      label: 'Voice' },
  { id: 'advanced',   label: 'Advanced' },
  { id: 'help',       label: 'Help' },
];

/**
 * Maps every legacy category id to the canonical section it now lives in.
 * Deep-link callers that pass an old id get silently forwarded to the right
 * section at runtime.
 *
 * Note: account-related ids (account, license, firm, costs, integrations) all
 * fall back to 'workspace' here, but in practice App.tsx intercepts those
 * deep-links and opens the AccountWindow instead of Settings.
 */
export const CATEGORY_ALIAS_MAP: Readonly<Record<string, SectionCategory>> = {
  // Workspace
  general:      'workspace',
  editor:       'workspace',
  files:        'workspace',
  // AI & Privacy
  ai:           'ai-privacy',
  memory:       'ai-privacy',
  privacy:      'ai-privacy',
  // Account (intercepted by App.tsx; falls back to workspace if Settings ever sees them)
  account:      'workspace',
  license:      'workspace',
  firm:         'workspace',
  costs:        'workspace',
  integrations: 'workspace',
  // Voice (unchanged)
  voice:        'voice',
  // Advanced (Extensions, Updates, Advanced subsections)
  marketplace:  'advanced',
  templates:    'advanced',
  updates:      'advanced',
  mobile:       'advanced',
  // Help (Keyboard Shortcuts, Setup/onboarding, About subsections)
  shortcuts:    'help',
  about:        'help',
  onboarding:   'help',
  // Canonical ids map to themselves
  workspace:    'workspace',
  'ai-privacy': 'ai-privacy',
  advanced:     'advanced',
  help:         'help',
};

/**
 * Resolve any SettingCategory (legacy alias or canonical) to its
 * SectionCategory.  Falls back to 'workspace' for unknown ids.
 */
export function resolveSection(cat: string): SectionCategory {
  return CATEGORY_ALIAS_MAP[cat] ?? 'workspace';
}

/**
 * Connector-access: one-time firm consent to store and AI-process the exported
 * reports/notes Advisor Prep Hero recognizes from outside tools (RightCapital, Jump).
 * Set the first time such an export would be used to answer (a deliberate
 * checkbox, also recorded in the audit log) and revocable here in Settings.
 * Lives in the schema (not free-form state) so it survives persistence — the
 * settings store drops unknown keys. Mirrors `confidentialityChoiceMade`.
 */
export const EXTERNAL_EXPORT_CONSENT_KEY = 'externalExportConsent';

/** Connector-access: a recognized plan snapshot older than this many days is
 *  flagged stale in the Ask sources and the answer. Plans only; meeting notes
 *  are never alarmed on age. */
export const EXTERNAL_EXPORT_STALE_DAYS_KEY = 'externalExportStaleDays';

export const SETTINGS_SCHEMA: SettingDefinition[] = [
  // ── Workspace: General ────────────────────────────────────────────────
  {
    key: 'theme',
    category: 'workspace',
    label: 'Theme',
    description: 'Choose light, dark, or follow your system preference.',
    type: 'select',
    defaultValue: 'light',
    options: [
      { value: 'system', label: 'System' },
      { value: 'light', label: 'Light' },
      { value: 'dark', label: 'Dark' },
    ],
  },
  {
    key: 'startupBehavior',
    category: 'workspace',
    label: 'On Startup',
    description: 'What happens when you launch Advisor Prep Hero.',
    type: 'select',
    defaultValue: 'reopen',
    options: [
      { value: 'reopen', label: 'Reopen last workspace' },
      { value: 'selector', label: 'Show workspace selector' },
    ],
  },
  {
    key: 'showWhatsNew',
    category: 'workspace',
    label: 'Show Update Notifications',
    description: 'Display a toast when a new version of Advisor Prep Hero is available.',
    type: 'toggle',
    defaultValue: true,
  },

  // ── Workspace: Editor ─────────────────────────────────────────────────
  {
    key: 'tabOverflow',
    category: 'workspace',
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
    category: 'workspace',
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
    category: 'workspace',
    label: 'Auto Save',
    description: 'Automatically save files after changes.',
    type: 'toggle',
    defaultValue: true,
  },
  {
    key: 'autoSaveInterval',
    category: 'workspace',
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
    category: 'workspace',
    label: 'Word Wrap',
    description: 'Wrap long lines instead of scrolling horizontally.',
    type: 'toggle',
    defaultValue: true,
  },
  {
    key: 'lineNumbers',
    category: 'workspace',
    label: 'Line Numbers',
    description: 'Show line numbers in text editors.',
    type: 'toggle',
    defaultValue: true,
  },

  // ── Workspace: Files & Workspace ──────────────────────────────────────
  {
    key: 'defaultNewFileType',
    category: 'workspace',
    label: 'Default New Document Type',
    description:
      'Format used when you create a new document. Word (.docx) is the canonical document format; choose Markdown or Plain Text for quick notes.',
    type: 'select',
    defaultValue: 'docx',
    options: [
      { value: 'docx', label: 'Word Document (.docx)' },
      { value: 'markdown', label: 'Markdown' },
      { value: 'plaintext', label: 'Plain Text' },
    ],
  },
  {
    key: 'letterheadTemplatePath',
    category: 'workspace',
    label: 'Letterhead Template',
    description:
      'Path to a Word document whose letterhead (headers, footers, styles) new documents and workflow deliverables start from. Pick one with the file tree right-click menu.',
    type: 'text',
    defaultValue: '',
  },
  {
    key: 'trashRetention',
    category: 'workspace',
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
    category: 'workspace',
    label: 'Show Hidden Files',
    description: 'Display files and folders that start with a dot (e.g., .gitignore).',
    type: 'toggle',
    defaultValue: false,
  },

  // ── AI & Privacy: AI ──────────────────────────────────────────────────
  {
    // Internal marker — not shown in the Settings UI. Set to true the first
    // time the user picks a confidentiality mode from the informed-choice
    // screen (or from ConfidentialityModeSettings via useRecordConfidentialityChoice).
    // resolveEffectiveEgress reads this to decide whether a personal install
    // has made an explicit, informed choice and cloud generation is allowed.
    // Must be in the schema so sanitizeSettingValue accepts the boolean value.
    key: 'confidentialityChoiceMade',
    category: 'ai-privacy',
    label: 'Confidentiality choice made',
    description: 'Internal flag: set when the user has explicitly chosen a confidentiality mode.',
    type: 'toggle',
    defaultValue: false,
  },
  {
    key: 'confidentialityMode',
    category: 'ai-privacy',
    label: 'Confidentiality mode',
    description:
      "Controls where AI requests are allowed to go. Local-only never sends your prompts or files to a cloud AI (local models only). Direct (the default) sends prompts straight from your machine to your chosen provider with your own key. Assured routes through your firm's zero-retention proxy once your firm admin sets a managed key.",
    type: 'select',
    defaultValue: 'direct',
    options: [
      { value: 'local-only', label: 'Local-only (no cloud AI)' },
      { value: 'direct', label: 'Direct (your key, your provider)' },
      { value: 'assured', label: 'Assured (firm managed key)' },
    ],
  },
  {
    key: 'privilegedMatterMode',
    category: 'ai-privacy',
    label: 'Privileged Matter Mode',
    description:
      'When on, network-capable extensions are disabled: plugins cannot make network requests and MCP servers are turned off, so confidential work cannot be sent out through an extension. Turns on automatically while a privileged matter is active or while Local-only is selected. A custom control for this lives in the confidentiality section.',
    type: 'toggle',
    defaultValue: false,
  },
  {
    key: 'ambientFileContext',
    category: 'ai-privacy',
    label: 'Ambient File Context',
    description: 'Automatically share open files with AI chat.',
    type: 'toggle',
    defaultValue: true,
  },
  {
    key: 'ambientContextTokenLimit',
    category: 'ai-privacy',
    label: 'Context Token Limit',
    description: 'Max tokens included from open files in AI prompts.',
    type: 'number',
    defaultValue: 50000,
    min: 10000,
    max: 200000,
    step: 5000,
  },
  {
    key: 'chatContextTokenLimit',
    category: 'ai-privacy',
    label: 'Chat Context Token Limit',
    description:
      'Maximum tokens sent to the AI per chat turn (includes history, files, and your message). Default is 200K. Raise only if your provider and model support a larger window.',
    type: 'number',
    defaultValue: 200000,
    min: 10000,
    max: 1000000,
    step: 10000,
  },
  {
    key: 'keepRecentTurns',
    category: 'ai-privacy',
    label: 'Keep Recent Turns (Compression)',
    description:
      'When compressing context, how many of the most recent conversation turns to keep verbatim.',
    type: 'number',
    defaultValue: 6,
    min: 2,
    max: 20,
    step: 1,
  },
  {
    // Connector-access: firm consent for storing + AI-processing recognized
    // exports from outside tools. Default off; set via the one-time checkbox
    // (or here). Shown so the choice is transparent and revocable.
    key: EXTERNAL_EXPORT_CONSENT_KEY,
    category: 'ai-privacy',
    label: 'Allow exported reports from other tools',
    description:
      'When on, Advisor Prep Hero may store and use your chosen AI on the reports and notes you export or save from outside tools like RightCapital and Jump (recognized automatically from the files you import). Advisor Prep Hero reads these exported files; it is not connected to those tools. You are asked once before this is first used, and that choice is recorded in your audit log. Turn off to stop using them.',
    type: 'toggle',
    defaultValue: false,
  },
  {
    key: EXTERNAL_EXPORT_STALE_DAYS_KEY,
    category: 'ai-privacy',
    label: 'Flag exported plans older than (days)',
    description:
      'A financial plan you export from a tool like RightCapital is a point-in-time snapshot. When a plan Advisor Prep Hero used to answer is older than this many days, it is flagged as possibly out of date in the sources and the answer. Meeting notes are never flagged on age.',
    type: 'number',
    defaultValue: 90,
    min: 7,
    max: 1000,
    step: 1,
  },
  {
    key: 'manageApiKeys',
    category: 'ai-privacy',
    label: 'AI Account Keys',
    description: 'Add or remove account keys for AI providers.',
    type: 'text', // rendered as action link
    defaultValue: '',
    action: { label: 'Manage AI Account Keys', actionId: 'open-ai-keys' },
  },
  {
    key: 'manageAIRules',
    category: 'ai-privacy',
    label: 'AI Rules',
    description: 'Customize how AI behaves in this workspace.',
    type: 'text', // rendered as action link
    defaultValue: '',
    action: { label: 'Manage AI Rules', actionId: 'open-ai-rules' },
  },

  // ── AI & Privacy: Memory ──────────────────────────────────────────────
  {
    key: 'memoryEnabled',
    category: 'ai-privacy',
    label: 'Workspace memory',
    description:
      'Index your workspace files locally so AI can recall relevant context. Embeddings live on your machine, nothing is sent anywhere.',
    type: 'toggle',
    defaultValue: true,
  },
  {
    key: 'factsInjection',
    category: 'ai-privacy',
    label: 'Inject memory facts into chat',
    description:
      'Prepend your saved memory facts to every chat system prompt so the AI always knows prior durable context. Turn off if you want workspace memory without the facts block.',
    type: 'toggle',
    defaultValue: true,
  },
  {
    key: 'factsAutoAccept',
    category: 'ai-privacy',
    label: 'Auto-accept proposed facts',
    description:
      'When enabled, facts that the AI extracts from your conversations are saved without asking. Default is off, so every proposed fact needs your approval.',
    type: 'toggle',
    defaultValue: false,
  },
  {
    // BUG-060: when the AI uses its file tools (write / move / delete) in chat,
    // how much should it pause for your approval? Reading/searching never asks.
    key: 'aiFileApprovalMode',
    category: 'ai-privacy',
    label: 'Approve AI file changes',
    description:
      'Choose when the AI must show you what it is about to do — and get your OK — before changing a file in your workspace. "Only risky changes" (recommended) lets it freely create new files but pauses to show a before/after whenever it would overwrite or delete something that already exists. "Every change" pauses for all file changes. "Review at the end" lets it work, then shows everything it changed for you to approve or undo together.',
    type: 'select',
    defaultValue: 'risky',
    options: [
      { value: 'risky', label: 'Only risky changes (recommended)' },
      { value: 'always', label: 'Every change' },
      { value: 'batch', label: 'Review at the end' },
    ],
  },
  {
    key: 'includePdfsInWorkspaceIndex',
    category: 'ai-privacy',
    label: 'Include PDFs in workspace index',
    description:
      'When on, PDFs in your workspace (including scanned PDFs, read with OCR) are searchable and considered for AI context. Indexing runs in the background. Defaults to on; turn it off to skip PDF indexing and save CPU.',
    type: 'toggle',
    defaultValue: true,
  },
  {
    key: 'ocrScannedPdfs',
    category: 'ai-privacy',
    label: 'Read scanned PDFs with OCR',
    description:
      'Read scanned PDFs with local OCR so they show up in search and AI answers. Runs entirely on your machine.',
    type: 'toggle',
    defaultValue: true,
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

  // ── Voice Output (TTS) ────────────────────────────────────────────────
  {
    key: 'ttsEnabled',
    category: 'voice',
    label: 'Text-to-speech output',
    description:
      'Enable the "Read aloud" button on AI responses. Runs a bundled speech engine on your machine — no API key, no cloud.',
    type: 'toggle',
    defaultValue: false,
  },
  {
    key: 'ttsVoice',
    category: 'voice',
    label: 'Voice',
    description:
      'Choose the default voice for text-to-speech. English (Amy) ships with the app; other languages download on first use.',
    type: 'select',
    defaultValue: 'en_US-amy-medium',
    options: [
      { value: 'en_US-amy-medium', label: 'English (Amy, medium)' },
      { value: 'es_ES-mls-medium', label: 'Spanish (MLS, medium)' },
      { value: 'de_DE-thorsten-medium', label: 'German (Thorsten, medium)' },
    ],
  },
  {
    key: 'ttsSpeed',
    category: 'voice',
    label: 'Playback speed',
    description: 'Adjust how fast the AI response is spoken (1.0 = normal).',
    type: 'number',
    defaultValue: 1.0,
    min: 0.5,
    max: 2.0,
    step: 0.1,
  },
  {
    key: 'ttsAutoRead',
    category: 'voice',
    label: 'Auto-read AI responses',
    description:
      'Automatically begin reading each AI response aloud as soon as it finishes streaming. Off by default.',
    type: 'toggle',
    defaultValue: false,
  },
  {
    key: 'ttsShortcut',
    category: 'voice',
    label: 'Read-aloud shortcut',
    description: 'Keyboard shortcut to read the focused AI message aloud.',
    type: 'shortcut-display',
    defaultValue: 'Ctrl+Shift+R',
  },

  // ── Meeting capture (Wave 3) ─────────────────────────────────────────
  {
    key: 'meetings.transcribeMode',
    category: 'voice',
    label: 'Meeting transcription',
    description:
      "Live starts transcribing the moment a recording stops. Battery saver waits until you're on AC power or tap \"Transcribe now\" — useful for long meetings on battery.",
    type: 'select',
    defaultValue: 'live',
    options: [
      { value: 'live', label: 'Live (transcribe as soon as recording stops)' },
      { value: 'batch', label: 'Battery saver (transcribe on AC power, or on demand)' },
    ],
  },

  // ── Recording notice (Recording Notice Kit) ──────────────────────────
  {
    // Firm-level notification policy. Standard: every notice step is offered
    // and the spoken notice is verified from the transcript; a missing notice
    // flags the meeting for review. Strict: a meeting whose spoken notice
    // isn't verified stays quarantined (visible, notes/transcript still
    // accessible — never destroyed) until a human resolves it.
    key: 'meetings.noticePolicy',
    category: 'privacy',
    label: 'Recording notice policy',
    description:
      'Standard verifies the spoken recording notice and flags a meeting for review when none is detected. Strict keeps an unverified meeting quarantined until you resolve it — nothing is ever deleted or stopped automatically.',
    type: 'select',
    defaultValue: 'standard',
    options: [
      { value: 'standard', label: 'Standard — flag meetings with no detected notice' },
      { value: 'strict', label: 'Strict — quarantine meetings until the notice is resolved' },
    ],
  },
  {
    // The firm-customizable spoken-notice script. Empty means "use the built-in
    // localized default" (shown in the consent dialog). When set, the text is
    // shown to the advisor to say AND fed to the transcript matcher as an
    // expected phrase, so an atypically-worded script still verifies.
    key: 'meetings.noticeScript',
    category: 'privacy',
    label: 'Spoken recording-notice script',
    description:
      'The exact words the consent dialog shows you to say out loud after recording starts. Leave blank to use the built-in wording. If you customize it, keep it a clear recording disclosure so the app can still verify it from the transcript.',
    type: 'text',
    defaultValue: '',
  },

  // ── Advanced: Updates ─────────────────────────────────────────────────
  {
    key: 'autoUpdateCheck',
    category: 'advanced',
    label: 'Check for updates automatically',
    description: 'When enabled, Advisor Prep Hero checks GitHub Releases for new versions in the background and prompts you when one is available.',
    type: 'toggle',
    defaultValue: true,
  },
  {
    key: 'updateChannel',
    category: 'advanced',
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
    category: 'advanced',
    label: 'Check for updates now',
    description: 'Run the updater check immediately without waiting for the scheduled interval.',
    type: 'text', // rendered as action link
    defaultValue: '',
    action: { label: 'Check now', actionId: 'updater-check-now' },
  },

  // ── Advanced: AI assistant developer view ─────────────────────────────
  {
    // Off by default. When off, the AI assistant hides the per-message
    // token, cost ($), and "context used of total" meters so it reads like
    // an assistant, not a developer console. Power users who want to watch
    // token spend can turn it on here. The underlying cost accounting still
    // runs either way; this only controls whether the meters are shown.
    key: 'showAiCostMeters',
    category: 'advanced',
    label: 'Show AI cost and usage meters',
    description:
      'Show the per-message token count, running cost, and context-usage meter in the AI assistant. Off by default for a cleaner assistant.',
    type: 'toggle',
    defaultValue: false,
  },

  // ── Advanced: Smarter search re-ranking (experimental, default OFF) ─────
  {
    // WS3d-A. When ON, Advisor Prep Hero runs a second, more careful scorer over the
    // documents the first search finds, re-ordering them so the most relevant
    // passage rises to the top. It needs a one-time model download and adds a
    // little time per search. OFF by default: search behaves exactly as it
    // does today. This is experimental and being measured before it becomes a
    // default.
    key: 'enableReranker',
    category: 'advanced',
    label: 'Smarter search re-ranking (experimental)',
    description:
      'Re-orders search results with a second, more careful relevance check so the best passage surfaces first. Requires a one-time model download and adds a little time per search. Off by default — leaving it off keeps search exactly as it is today.',
    type: 'toggle',
    defaultValue: false,
  },
  {
    key: 'enableHybridSearch',
    category: 'advanced',
    label: 'Keyword + meaning search (experimental)',
    description:
      'Also matches the exact words in your search — names, case numbers, citations — and blends those hits with the meaning-based results, so a passage that uses your exact terms is more likely to surface. Off by default; leaving it off keeps search exactly as it is today.',
    type: 'toggle',
    defaultValue: false,
  },

  // ── Help: Setup / Onboarding ──────────────────────────────────────────
  {
    key: 'viewApiKeyTutorial',
    category: 'help',
    label: 'Account Key Setup Guide',
    description: 'Step-by-step guide to get an account key from Anthropic, OpenAI, or Google.',
    type: 'text',
    defaultValue: '',
    action: { label: 'View guide', actionId: 'open-api-key-tutorial' },
  },
  {
    key: 'resetFeatureTour',
    category: 'help',
    label: 'Feature Tour',
    description: 'Replay the guided tour that introduces the Advisor Prep Hero workspace.',
    type: 'text',
    defaultValue: '',
    action: { label: 'Start tour', actionId: 'reset-feature-tour' },
  },

  // ── Help: About ───────────────────────────────────────────────────────
  {
    key: 'aboutWhatsNew',
    category: 'help',
    label: "What's new",
    description: 'See highlights from the most recent Advisor Prep Hero releases.',
    type: 'text',
    defaultValue: '',
    action: { label: "What's new", actionId: 'open-whats-new' },
  },
  {
    key: 'aboutWebsite',
    category: 'help',
    label: 'Website',
    description: 'Open keepance.com in your browser.',
    type: 'text',
    defaultValue: '',
    action: { label: 'Open website', actionId: 'open-website' },
  },
  {
    key: 'aboutGithub',
    category: 'help',
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
