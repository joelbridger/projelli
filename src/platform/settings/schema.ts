/**
 * Settings Schema — Single source of truth for every user-configurable setting.
 *
 * The Settings modal renders FROM this schema. Adding a new setting later
 * means adding one entry to `SETTINGS_SCHEMA` — no component changes needed.
 *
 * v3.3 — 20 flat categories collapsed into simple sections:
 *   Workspace | AI | Privacy | Scheduling | Voice | Advanced | Help
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

import { brandText } from '@/config/brandText';
import type { SettingsSectionId } from '@/platform/types/settings';

export type SettingType = 'toggle' | 'select' | 'number' | 'text' | 'shortcut-display';

/** The canonical section ids used in the sidebar nav. */
export type SectionCategory = SettingsSectionId;

/**
 * SettingCategory includes both the 6 new section ids AND every legacy id so
 * that callers that pass e.g. `initialCategory="ai"` still type-check.
 * 'account' is kept as a legacy alias (deep-links are intercepted in App.tsx
 * and redirected to the AccountWindow before Settings ever sees them).
 */
export type SettingCategory =
  // ── 6 canonical sections ──────────────────────────────────────────────
  | 'workspace'
  | 'ai'
  | 'privacy'
  | 'scheduling'
  | 'voice'
  | 'advanced'
  | 'help'
  | 'organization'
  // ── legacy aliases (kept for deep-link compatibility) ─────────────────
  | 'account'
  | 'general'
  | 'license'
  | 'firm'
  | 'editor'
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
  | 'ai-privacy'
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
  // AI
  ai:           'ai',
  memory:       'ai',
  'ai-privacy': 'ai',
  // Privacy
  privacy:      'privacy',
  scheduling:   'scheduling',
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
  advanced:     'advanced',
  help:         'help',
  organization: 'organization',
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
 * reports/notes Lantern recognizes from outside tools (RightCapital, Jump).
 * Set the first time such an export would be used to answer (a deliberate
 * checkbox, also recorded in the audit log) and revocable here in Settings.
 * Lives in the schema (not free-form state) so it survives persistence — the
 * settings store drops unknown keys. Mirrors `confidentialityChoiceMade`.
 */
export const EXTERNAL_EXPORT_CONSENT_KEY = 'externalExportConsent';

/**
 * Firm choice for the exceptional email-reply classifier path. It remains off
 * until the firm deliberately accepts that authenticated client email text is
 * sent to its configured AI provider.
 */
export const EMAIL_REPLY_AI_CLASSIFICATION_SETTING_KEY = 'intake.emailReplyAiClassificationEnabled';

/** Connector-access: a recognized plan snapshot older than this many days is
 *  flagged stale in the Ask sources and the answer. Plans only; meeting notes
 *  are never alarmed on age. */
export const EXTERNAL_EXPORT_STALE_DAYS_KEY = 'externalExportStaleDays';

/**
 * Existing built-in definitions. The settings registry owns their placement;
 * keep definitions here as the stable platform contract for stores and imports.
 */
export const BASE_SETTINGS_SCHEMA: readonly SettingDefinition[] = [
  // ── Workspace: General ────────────────────────────────────────────────
  {
    key: 'startupBehavior',
    category: 'workspace',
    label: 'On startup',
    description: brandText('Choose what Lantern opens when the app starts.'),
    type: 'select',
    defaultValue: 'reopen',
    options: [
      { value: 'reopen', label: 'Reopen where you left off' },
      { value: 'selector', label: 'Show workspace selector' },
    ],
  },
  {
    key: 'showWhatsNew',
    category: 'workspace',
    label: 'Update notifications',
    description: brandText('Display a toast when a new version of Lantern is available.'),
    type: 'toggle',
    defaultValue: true,
  },

  // ── Workspace: Editor ─────────────────────────────────────────────────
  {
    key: 'tabOverflow',
    category: 'workspace',
    label: 'Tabs',
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
    label: 'Font size',
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
    label: 'Autosave',
    description: 'Automatically save files after changes.',
    type: 'toggle',
    defaultValue: true,
  },
  {
    key: 'autoSaveInterval',
    category: 'workspace',
    label: 'Autosave delay',
    description: 'How many seconds Lantern waits after you stop typing before it saves.',
    type: 'number',
    defaultValue: 2,
    min: 1,
    max: 30,
    step: 1,
  },
  {
    key: 'wordWrap',
    category: 'workspace',
    label: 'Word wrap',
    description: 'Wrap long lines instead of scrolling horizontally.',
    type: 'toggle',
    defaultValue: true,
  },
  {
    key: 'lineNumbers',
    category: 'workspace',
    label: 'Line numbers',
    description: 'Show line numbers in text editors.',
    type: 'toggle',
    defaultValue: true,
  },

  // ── Workspace: Files & Workspace ──────────────────────────────────────
  {
    key: 'defaultNewFileType',
    category: 'workspace',
    label: 'New document type',
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
    label: 'Letterhead template',
    description:
      'Use a Word document that already has your firm header, footer, and styles. Example: Firm Letterhead.docx. Pick one from the file list menu.',
    type: 'text',
    defaultValue: '',
  },
  {
    key: 'trashRetention',
    category: 'workspace',
    label: 'Trash retention',
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
    label: 'Show hidden files',
    description: 'Show files and folders that are normally tucked away, like .gitignore or .lantern system folders.',
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
    label: 'Network Lockdown',
    description:
      'When on, network-capable extensions are disabled: plugins cannot make network requests and MCP servers are turned off, so confidential work cannot be sent out through an extension. Turns on automatically while a sensitive client is active or while Local-only is selected. A custom control for this lives in the confidentiality section.',
    type: 'toggle',
    defaultValue: false,
  },
  {
    key: 'ambientFileContext',
    category: 'ai-privacy',
    label: 'Open files in AI',
    description: 'Automatically share open files with AI chat.',
    type: 'toggle',
    defaultValue: true,
  },
  {
    key: 'ambientContextTokenLimit',
    category: 'ai-privacy',
    label: 'Open-file limit',
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
    label: 'Chat limit',
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
    label: 'Keep recent turns',
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
      brandText('When on, Lantern may store and use your chosen AI on the reports and notes you export or save from outside tools like RightCapital and Jump (recognized automatically from the files you import). Lantern reads these exported files; it is not connected to those tools. You are asked once before this is first used, and that choice is recorded in your audit log. Turn off to stop using them.'),
    type: 'toggle',
    defaultValue: false,
  },
  {
    key: EXTERNAL_EXPORT_STALE_DAYS_KEY,
    category: 'ai-privacy',
    label: 'Flag exported plans older than (days)',
    description:
      brandText('A financial plan you export from a tool like RightCapital is a point-in-time snapshot. When a plan Lantern used to answer is older than this many days, it is flagged as possibly out of date in the sources and the answer. Meeting notes are never flagged on age.'),
    type: 'number',
    defaultValue: 90,
    min: 7,
    max: 1000,
    step: 1,
  },
  {
    key: 'manageApiKeys',
    category: 'ai-privacy',
    label: 'AI account keys',
    description: 'Add or remove account keys for AI providers.',
    type: 'text', // rendered as action link
    defaultValue: '',
    action: { label: 'Manage AI account keys', actionId: 'open-ai-keys' },
  },
  {
    key: 'manageAIRules',
    category: 'ai-privacy',
    label: 'AI rules',
    description:
      'Opens ai-rules.md — standing instructions the AI follows in every chat.',
    type: 'text', // rendered as action link
    defaultValue: '',
    action: { label: 'Manage AI rules', actionId: 'open-ai-rules' },
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
    label: 'Add saved facts to chat',
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
      'Choose when the AI must show you what it is about to do and get your OK before changing a file in your workspace. "Only risky changes" (recommended) lets it freely create new files but pauses to show a before/after whenever it would overwrite or delete something that already exists. "Every change" pauses for all file changes. "Review at the end" lets it work, then shows everything it changed for you to approve or undo together.',
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
      'Hold Ctrl+Shift+Space (Cmd+Shift+Space on Mac) to talk; release to transcribe and insert at the cursor. Runs a bundled speech-recognition binary on your machine. No network or API key.',
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
      'Enable the "Read aloud" button on AI responses. Runs a bundled speech engine on your machine. No API key or cloud.',
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
      "Live starts transcribing the moment a recording stops. Battery saver waits until you're on AC power or tap \"Transcribe now\", useful for long meetings on battery.",
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
      'Standard verifies the spoken recording notice and flags a meeting for review when none is detected. Strict keeps an unverified meeting quarantined until you resolve it. Nothing is ever deleted or stopped automatically.',
    type: 'select',
    defaultValue: 'standard',
    options: [
      { value: 'standard', label: 'Standard - flag meetings with no detected notice' },
      { value: 'strict', label: 'Strict - quarantine meetings until the notice is resolved' },
    ],
  },
  {
    key: EMAIL_REPLY_AI_CLASSIFICATION_SETTING_KEY,
    category: 'privacy',
    label: 'AI email reply classification',
    description:
      'Firm setting. Off by default. When enabled, the text of authenticated client email replies is sent to your firm\'s configured AI provider to help match an onboarding item.',
    type: 'toggle',
    defaultValue: false,
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
  {
    // Firm default for whether the Notice Card is offered (pre-checked) in the
    // consent dialog when the meeting has a join link. Never auto-joins without
    // the toggle; the advisor can uncheck it per meeting.
    key: 'meetings.noticeCardEnabled',
    category: 'privacy',
    label: 'Offer the Notice Card for online meetings',
    description:
      'When a meeting has a Teams or Zoom link, offer to add the Notice Card, a participant that runs on your computer, shows everyone the meeting is being recorded, records nothing, and leaves when recording ends. You can turn it off for any single meeting.',
    type: 'toggle',
    defaultValue: true,
  },
  {
    // The guest display name template. `{advisor}` is replaced with the
    // advisor's first name. Kept short; per-platform length guards apply.
    key: 'meetings.noticeCardNameTemplate',
    category: 'privacy',
    label: 'Notice Card name',
    description:
      'The name the Notice Card shows in the participant list. Use {product} for the app name and {advisor} for your first name. The leading recording symbol makes it clear at a glance, even camera-off.',
    type: 'text',
    defaultValue: '⏺ Recording · {product}',
  },
  {
    // What satisfies the Strict policy: verbal notice OR full-duration card
    // presence (either), or both required. Verbal stays recommended everywhere.
    key: 'meetings.noticeEvidenceRule',
    category: 'privacy',
    label: 'What satisfies a Strict recording notice',
    description:
      'Under Strict, decide what counts as proof a meeting was disclosed: either a verified spoken notice or the Notice Card present for the whole recording, or require both. A spoken notice is always the strongest single evidence and works on phone calls too.',
    type: 'select',
    defaultValue: 'either',
    options: [
      { value: 'either', label: 'Either - a spoken notice or full-meeting card presence' },
      { value: 'both', label: 'Both - a spoken notice and full-meeting card presence' },
    ],
  },

  // ── Advanced: Updates ─────────────────────────────────────────────────
  {
    key: 'autoUpdateCheck',
    category: 'advanced',
    label: 'Automatic updates',
    description: brandText('When enabled, Lantern checks GitHub Releases for new versions in the background and prompts you when one is available.'),
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
    // WS3d-A. When ON, Lantern runs a second, more careful scorer over the
    // documents the first search finds, re-ordering them so the most relevant
    // passage rises to the top. It needs a one-time model download and adds a
    // little time per search. OFF by default: search behaves exactly as it
    // does today. This is experimental and being measured before it becomes a
    // default.
    key: 'enableReranker',
    category: 'advanced',
    label: 'Smarter search re-ranking (experimental)',
    description:
      'Re-orders search results with a second, more careful relevance check so the best passage surfaces first. Requires a one-time model download and adds a little time per search. Off by default; leaving it off keeps search exactly as it is today.',
    type: 'toggle',
    defaultValue: false,
  },
  {
    key: 'enableHybridSearch',
    category: 'advanced',
    label: 'Keyword + meaning search (experimental)',
    description:
      'Also matches the exact words in your search, like names, case numbers, and citations, and blends those hits with the meaning-based results, so a passage that uses your exact terms is more likely to surface. Off by default; leaving it off keeps search exactly as it is today.',
    type: 'toggle',
    defaultValue: false,
  },

  // ── Help: Setup / Onboarding ──────────────────────────────────────────
  {
    key: 'viewApiKeyTutorial',
    category: 'help',
    label: 'Account key setup guide',
    description: 'Step-by-step guide to get an account key from Anthropic, OpenAI, or Google.',
    type: 'text',
    defaultValue: '',
    action: { label: 'View guide', actionId: 'open-api-key-tutorial' },
  },
  {
    key: 'resetFeatureTour',
    category: 'help',
    label: 'Feature tour',
    description: brandText('Replay the guided tour that introduces the Lantern workspace.'),
    type: 'text',
    defaultValue: '',
    action: { label: 'Start tour', actionId: 'reset-feature-tour' },
  },

  // ── Help: About ───────────────────────────────────────────────────────
  {
    key: 'aboutWhatsNew',
    category: 'help',
    label: "What's new",
    description: brandText('See highlights from the most recent Lantern releases.'),
    type: 'text',
    defaultValue: '',
    action: { label: "What's new", actionId: 'open-whats-new' },
  },
  {
    key: 'aboutWebsite',
    category: 'help',
    label: 'Website',
    description: 'Open lantern.com in your browser.',
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
 * The durable schema is deliberately kept in its authored order. Apart from
 * being a stable contract, this order is used when exporting settings JSON.
 * Feature registries consume this schema to mount UI sections; the platform
 * never imports a feature registry to construct its own store contract.
 */
export const SETTINGS_SCHEMA: readonly SettingDefinition[] = BASE_SETTINGS_SCHEMA;

/** The canonical nav sections shown in the sidebar. */
export const SETTING_CATEGORIES: readonly { id: SectionCategory; label: string }[] = [
  { id: 'workspace', label: 'Workspace' },
  { id: 'ai', label: 'AI' },
  { id: 'privacy', label: 'Privacy' },
  { id: 'scheduling', label: 'Scheduling' },
  { id: 'voice', label: 'Voice' },
  { id: 'advanced', label: 'Advanced' },
  { id: 'help', label: 'Help' },
  { id: 'organization', label: 'Organization' },
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
