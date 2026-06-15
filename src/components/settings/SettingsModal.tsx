/**
 * SettingsModal — Full-screen settings dialog rendered from the schema.
 *
 * Layout:
 *   Left sidebar  — 5-section nav (Workspace / AI & Privacy / Account / Voice / Advanced & Help)
 *   Right content — settings for the active section, rendered with sub-headers
 *   Top           — cross-section search bar
 *   Bottom-right  — Export / Import / Reset buttons
 *
 * Deep-link aliases: any legacy category id (general, ai, integrations, etc.)
 * resolves to the correct section via CATEGORY_ALIAS_MAP in schema.ts.
 *
 * Opened via: gear icon in the header, Ctrl+, shortcut, or command palette.
 */

import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import {
  SETTINGS_SCHEMA,
  SETTING_CATEGORIES,
  resolveSection,
  type SettingCategory,
  type SectionCategory,
  type SettingDefinition,
} from '@/settings/schema';
import { useSettingsStore } from '@/stores/settingsStore';
import {
  isLimitExceedingCapability,
  getMaxContextTokens,
  formatContextSize,
} from '@/modules/models/context-limits';
import { CostMetrics } from '@/components/analysis/CostMetrics';
import { TemplateModelSettings } from '@/components/settings/TemplateModelSettings';
import { LicenseSettings } from '@/components/settings/LicenseSettings';
import { PrivacySettings } from '@/components/settings/PrivacySettings';
import { ConfidentialityModeSettings } from '@/components/settings/ConfidentialityModeSettings';
import { FirmSignIn } from '@/components/firm/FirmSignIn';
import { FirmAdminConsole } from '@/components/firm/FirmAdminConsole';
import { MemoryFactsSettings } from '@/components/settings/MemoryFactsSettings';
import { MarketplaceTab } from '@/components/marketplace/MarketplaceTab';
import { useTemplateUpdateCount } from '@/hooks/useTemplatesMarketplace';
import { usePluginUpdateCount } from '@/hooks/usePluginsMarketplace';
import { MobileSettings } from '@/components/settings/MobileSettings';
import { PluginsSettings } from '@/components/settings/PluginsSettings';
import { AdvancedSettings } from '@/components/settings/AdvancedSettings';
import { McpSettingsSection } from '@/components/settings/McpSettingsSection';
import { OllamaSettingsSection } from '@/components/settings/OllamaSettingsSection';
import { VoiceSettingsSection } from '@/components/settings/VoiceSettingsSection';
import { MailConnect } from '@/components/settings/MailConnect';
import { MailImapConnect } from '@/components/settings/MailImapConnect';
import { MailGmailConnect } from '@/components/settings/MailGmailConnect';
import { LanguagePicker } from '@/components/settings/LanguagePicker';
import { SetupChecklist } from '@/components/settings/SetupChecklist';
import { ApiKeyWizard } from '@/components/onboarding/ApiKeyWizard';
import type { AuditEntry } from '@/types/audit';
import type { WorkflowTemplate } from '@/types/workflow';
import {
  SHORTCUTS,
  groupShortcutsByCategory,
  formatShortcutHint,
  isMac,
} from '@/utils/shortcuts';
import {
  Search,
  X,
  Upload,
  Download,
  RotateCcw,
  ChevronDown,
  ChevronUp,
  ExternalLink,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface SettingsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Callback when an action link is clicked (e.g., "Manage API Keys"). */
  onAction?: (actionId: string) => void;
  /**
   * Q4 (Wave 1.2) — audit entries for the Account section (Usage sub-header).
   * When omitted, the Cost & Usage dashboard renders with an empty array.
   */
  auditEntries?: AuditEntry[];
  /**
   * Q8 (Wave 1.6) — workflow templates (built-ins + user-authored) used to
   * render the per-template model assignment table in the Advanced & Help
   * section (Extensions sub-header). When omitted, the table shows an empty
   * state.
   */
  templates?: WorkflowTemplate[];
  /**
   * Which category (canonical section id OR legacy alias) to open the modal
   * on. Re-applied every time the modal transitions from closed to open, so
   * callers can deep-link to any section without persisting state across opens.
   *
   * Legacy ids (general, ai, integrations, memory, etc.) are silently resolved
   * to the correct section via CATEGORY_ALIAS_MAP.
   */
  initialCategory?: SettingCategory;
  /** Called when the user clicks "Restart guided setup" in the setup checklist. */
  onRestartOnboarding?: () => void;
}

// ---------------------------------------------------------------------------
// Toggle switch
// ---------------------------------------------------------------------------

function Toggle({
  checked,
  onChange,
  id,
  testid,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  id?: string;
  testid?: string;
}) {
  return (
    <button
      id={id}
      data-testid={testid}
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        checked ? 'bg-primary' : 'bg-muted'
      )}
    >
      <span
        className={cn(
          'pointer-events-none block h-5 w-5 rounded-full bg-background shadow-lg ring-0 transition-transform',
          checked ? 'translate-x-5' : 'translate-x-0'
        )}
      />
    </button>
  );
}

/** Map a SETTINGS_SCHEMA `key` to the kebab-case test id callers know
 *  about. Keeps test selectors stable when refactoring. */
function settingTestid(key: string): string | undefined {
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
// Number input with +/- steppers
// ---------------------------------------------------------------------------

function NumberStepper({
  value,
  onChange,
  min,
  max,
  step = 1,
  id,
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  id?: string;
}) {
  const clamp = (v: number) => {
    let n = v;
    if (min !== undefined) n = Math.max(min, n);
    if (max !== undefined) n = Math.min(max, n);
    return n;
  };

  return (
    <div className="flex items-center gap-1">
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-8 w-8 p-0"
        onClick={() => onChange(clamp(value - step))}
        disabled={min !== undefined && value <= min}
        aria-label="Decrease"
      >
        <ChevronDown className="h-3 w-3" />
      </Button>
      <Input
        id={id}
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => {
          const parsed = Number(e.target.value);
          if (!isNaN(parsed)) onChange(clamp(parsed));
        }}
        className="w-24 h-8 text-center text-sm"
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-8 w-8 p-0"
        onClick={() => onChange(clamp(value + step))}
        disabled={max !== undefined && value >= max}
        aria-label="Increase"
      >
        <ChevronUp className="h-3 w-3" />
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Inline capability warning for chatContextTokenLimit
// ---------------------------------------------------------------------------

function AIContextCapabilityWarning({
  getSetting,
}: {
  getSetting: (key: string) => unknown;
}) {
  const { t } = useTranslation();
  const chatLimitValue = (getSetting('chatContextTokenLimit') as number | undefined) ?? 200000;
  const activeProvider = (getSetting('defaultProvider') as string | undefined) ?? '';
  const activeModel = (getSetting('defaultModel') as string | undefined) ?? '';

  if (!activeProvider || !activeModel) return null;

  const exceeds = isLimitExceedingCapability(activeProvider, activeModel, chatLimitValue);
  if (!exceeds) return null;

  const modelMax = getMaxContextTokens(activeProvider, activeModel);
  return (
    <p
      className="text-xs text-amber-600 mt-1 px-1 pb-2"
      data-testid="context-limit-warning"
    >
      {t('settings.modal.context-warning', { max: formatContextSize(modelMax) })}
    </p>
  );
}

// ---------------------------------------------------------------------------
// Individual setting row
// ---------------------------------------------------------------------------

function SettingRow({
  def,
  value,
  onChange,
  onAction,
}: {
  def: SettingDefinition;
  value: unknown;
  onChange: (v: unknown) => void;
  onAction?: (actionId: string) => void;
}) {
  const controlId = `setting-control-${def.key}`;

  // Action link (e.g. "Manage API Keys")
  if (def.action) {
    return (
      <div
        data-testid={`setting-${def.key}`}
        className="flex items-center justify-between py-3 border-b border-border/50 last:border-b-0"
      >
        <div className="flex-1 min-w-0 mr-4">
          <Label className="text-sm font-medium">{def.label}</Label>
          <p className="text-xs text-muted-foreground mt-0.5">{def.description}</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="shrink-0 gap-1.5 text-xs"
          onClick={() => onAction?.(def.action!.actionId)}
        >
          {def.action.label}
          <ExternalLink className="h-3 w-3" />
        </Button>
      </div>
    );
  }

  let control: React.ReactNode = null;

  switch (def.type) {
    case 'toggle': {
      const tid = settingTestid(def.key);
      control = (
        <Toggle
          id={controlId}
          checked={Boolean(value)}
          onChange={(v) => onChange(v)}
          {...(tid ? { testid: tid } : {})}
        />
      );
      break;
    }

    case 'select':
      control = (
        <select
          id={controlId}
          value={String(value ?? def.defaultValue)}
          onChange={(e) => onChange(e.target.value)}
          className="h-8 rounded-md border border-input bg-background px-3 py-1 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring cursor-pointer"
        >
          {def.options?.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      );
      break;

    case 'number':
      control = (
        <NumberStepper
          id={controlId}
          value={Number(value ?? def.defaultValue)}
          onChange={(v) => onChange(v)}
          {...(def.min !== undefined ? { min: def.min } : {})}
          {...(def.max !== undefined ? { max: def.max } : {})}
          {...(def.step !== undefined ? { step: def.step } : {})}
        />
      );
      break;

    case 'text':
      control = (
        <Input
          id={controlId}
          value={String(value ?? '')}
          onChange={(e) => onChange(e.target.value)}
          className="max-w-[220px] h-8 text-sm"
        />
      );
      break;

    default:
      break;
  }

  return (
    <div
      data-testid={`setting-${def.key}`}
      className="flex items-center justify-between py-3 border-b border-border/50 last:border-b-0"
    >
      <div className="flex-1 min-w-0 mr-4">
        <Label htmlFor={controlId} className="text-sm font-medium cursor-pointer">
          {def.label}
        </Label>
        <p className="text-xs text-muted-foreground mt-0.5">{def.description}</p>
      </div>
      <div className="shrink-0">{control}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-section header (used inside long sections to group controls)
// ---------------------------------------------------------------------------

function SubHeader({ label, testid }: { label: string; testid?: string }) {
  return (
    <h3
      data-testid={testid}
      className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mt-6 mb-2 pb-1 border-b border-border/40"
    >
      {label}
    </h3>
  );
}

// ---------------------------------------------------------------------------
// Keyboard shortcuts section (SSOT)
// ---------------------------------------------------------------------------

function ShortcutsSection({ searchQuery }: { searchQuery: string }) {
  const { t } = useTranslation();
  const grouped = useMemo(() => groupShortcutsByCategory(), []);
  const mac = isMac();
  const lowerQ = searchQuery.toLowerCase();

  const filtered = useMemo(() => {
    if (!lowerQ) return grouped;
    const result = new Map<string, typeof SHORTCUTS>();
    for (const [cat, shortcuts] of grouped) {
      const matching = shortcuts.filter(
        (s) =>
          s.label.toLowerCase().includes(lowerQ) ||
          (s.description ?? '').toLowerCase().includes(lowerQ) ||
          s.keys.some((k) => k.toLowerCase().includes(lowerQ))
      );
      if (matching.length > 0) result.set(cat, matching);
    }
    return result;
  }, [grouped, lowerQ]);

  if (filtered.size === 0) {
    return (
      <p className="text-sm text-muted-foreground py-4 text-center">
        {t('settings.modal.shortcuts.no-matches')}
      </p>
    );
  }

  return (
    <div className="space-y-5">
      <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm">
        <span className="font-medium">{t('settings.modal.shortcuts.quick-tip-label')}</span>{' '}
        {t('settings.modal.shortcuts.quick-tip-press')}{' '}
        <kbd className="px-1.5 py-0.5 rounded bg-muted text-xs font-mono">
          {mac ? '⌘' : 'Ctrl'}+P
        </kbd>{' '}
        {t('settings.modal.shortcuts.quick-tip-open-file')}{' '}
        <kbd className="px-1.5 py-0.5 rounded bg-muted text-xs font-mono">?</kbd>{' '}
        {t('settings.modal.shortcuts.quick-tip-overlay')}
      </div>

      {Array.from(filtered.entries()).map(([category, shortcuts]) => (
        <div key={category}>
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
            {category}
          </h3>
          <div className="space-y-1">
            {shortcuts.map((s) => (
              <div
                key={s.id}
                data-testid={`setting-shortcut-${s.id}`}
                className="flex items-center justify-between py-1.5 px-2 rounded hover:bg-muted/50"
              >
                <div className="flex-1 min-w-0">
                  <span className="text-sm">{s.label}</span>
                  {s.description && (
                    <span className="text-xs text-muted-foreground ml-2">
                      {s.description}
                    </span>
                  )}
                </div>
                <kbd className="px-2 py-1 rounded bg-muted text-xs font-mono shrink-0">
                  {formatShortcutHint(s.keys)}
                </kbd>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// About header
// ---------------------------------------------------------------------------

function AboutHeader() {
  const { t } = useTranslation();
  const version =
    (import.meta.env['VITE_APP_VERSION'] as string | undefined) ?? '?';
  return (
    <div
      data-testid="settings-about-header"
      className="mb-4 pb-4 border-b border-border/50"
    >
      <div className="flex items-baseline gap-2">
        <h3 className="text-base font-semibold">Keepance</h3>
        <span className="text-sm text-muted-foreground" data-testid="settings-about-version">
          v{version}
        </span>
      </div>
      <p className="text-xs text-muted-foreground mt-1">
        {t('settings.modal.about-tagline')}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section content renderers
// ---------------------------------------------------------------------------

interface SectionProps {
  getSetting: (key: string) => unknown;
  setSetting: (key: string, value: unknown) => void;
  onAction: (actionId: string) => void;
  filteredKeys: Set<string>;
  searchQuery: string;
  auditEntries?: AuditEntry[] | undefined;
  templates?: WorkflowTemplate[] | undefined;
  onRestartOnboarding?: (() => void) | undefined;
  onNavigate: (section: SectionCategory) => void;
}

function renderRows(
  keys: string[],
  props: SectionProps,
) {
  return keys
    .filter((k) => props.filteredKeys.has(k))
    .map((k) => {
      const def = SETTINGS_SCHEMA.find((d) => d.key === k);
      if (!def) return null;
      return (
        <SettingRow
          key={def.key}
          def={def}
          value={props.getSetting(def.key)}
          onChange={(v) => props.setSetting(def.key, v)}
          onAction={props.onAction}
        />
      );
    });
}

function WorkspaceSection(props: SectionProps) {
  const generalKeys = ['theme', 'startupBehavior', 'showWhatsNew'];
  const editorKeys  = ['tabOverflow', 'fontSize', 'autoSave', 'autoSaveInterval', 'wordWrap', 'lineNumbers'];
  const filesKeys   = ['defaultNewFileType', 'letterheadTemplatePath', 'trashRetention', 'showHiddenFiles'];

  const hasGeneral = generalKeys.some((k) => props.filteredKeys.has(k));
  const hasEditor  = editorKeys.some((k) => props.filteredKeys.has(k));
  const hasFiles   = filesKeys.some((k) => props.filteredKeys.has(k));

  return (
    <div data-testid="section-workspace">
      {hasGeneral && (
        <>
          <LanguagePicker />
          {renderRows(generalKeys, props)}
        </>
      )}
      {hasEditor && (
        <>
          <SubHeader label="Editor" testid="subheader-editor" />
          {renderRows(editorKeys, props)}
        </>
      )}
      {hasFiles && (
        <>
          <SubHeader label="Files and Workspace" testid="subheader-files" />
          {renderRows(filesKeys, props)}
        </>
      )}
    </div>
  );
}

function AiPrivacySection(props: SectionProps) {
  const aiKeys     = ['ambientFileContext', 'ambientContextTokenLimit', 'chatContextTokenLimit', 'keepRecentTurns', 'manageApiKeys', 'manageAIRules'];
  const memoryKeys = ['memoryEnabled', 'factsInjection', 'factsAutoAccept', 'includePdfsInWorkspaceIndex', 'ocrScannedPdfs'];
  // confidentialityMode and privilegedMatterMode are rendered by ConfidentialityModeSettings

  const hasAi     = ['confidentialityMode', 'privilegedMatterMode', ...aiKeys].some((k) => props.filteredKeys.has(k));
  const hasMemory = memoryKeys.some((k) => props.filteredKeys.has(k));

  return (
    <div data-testid="section-ai-privacy">
      {hasAi && (
        <>
          <SubHeader label="AI" testid="subheader-ai" />
          <ConfidentialityModeSettings />
          {renderRows(aiKeys, props)}
          <AIContextCapabilityWarning getSetting={props.getSetting} />
        </>
      )}
      {hasMemory && (
        <>
          <SubHeader label="Memory" testid="subheader-memory" />
          {renderRows(memoryKeys, props)}
          <MemoryFactsSettings />
        </>
      )}
      {/* Privacy always shown in this section */}
      <SubHeader label="Privacy" testid="subheader-privacy" />
      <PrivacySettings />
    </div>
  );
}

function AccountSection(props: SectionProps) {
  return (
    <div data-testid="section-account">
      <SubHeader label="Account" testid="subheader-account" />
      <LicenseSettings />

      <SubHeader label="Firm" testid="subheader-firm" />
      <FirmSignIn />
      <FirmAdminConsole />

      <SubHeader label="Usage" testid="subheader-usage" />
      <CostMetrics entries={props.auditEntries ?? []} />

      <SubHeader label="Connections" testid="subheader-connections" />
      <MailConnect />
      <MailImapConnect />
      <MailGmailConnect />
      <McpSettingsSection />
      <OllamaSettingsSection />
    </div>
  );
}

function VoiceSection(props: SectionProps) {
  const voiceInputKeys = [
    'voiceEnabled',
    'voiceModel',
    'voicePressToTalkShortcut',
    'voiceNoteShortcut',
  ];
  const ttsKeys = [
    'ttsEnabled',
    'ttsVoice',
    'ttsSpeed',
    'ttsAutoRead',
    'ttsShortcut',
  ];

  const ttsEnabled = Boolean(props.getSetting('ttsEnabled'));

  const hasVoiceInput = voiceInputKeys.some((k) => props.filteredKeys.has(k));
  const hasTts        = ttsKeys.some((k) => props.filteredKeys.has(k));

  return (
    <div data-testid="section-voice">
      <VoiceSettingsSection ttsEnabled={ttsEnabled} />
      {hasVoiceInput && renderRows(voiceInputKeys, props)}
      {hasTts && (
        <>
          <SubHeader label="Text to Speech" testid="subheader-tts" />
          {renderRows(ttsKeys, props)}
        </>
      )}
    </div>
  );
}

function AdvancedHelpSection(props: SectionProps) {
  const updatesKeys  = ['autoUpdateCheck', 'updateChannel', 'manualCheckNow'];
  const onboardKeys  = ['viewApiKeyTutorial', 'resetFeatureTour'];
  const aboutKeys    = ['aboutWhatsNew', 'aboutWebsite', 'aboutGithub'];

  const hasUpdates  = updatesKeys.some((k) => props.filteredKeys.has(k));
  const hasOnboard  = onboardKeys.some((k) => props.filteredKeys.has(k));
  const hasAbout    = aboutKeys.some((k) => props.filteredKeys.has(k));

  return (
    <div data-testid="section-advanced-help">
      <SubHeader label="Keyboard Shortcuts" testid="subheader-shortcuts" />
      <ShortcutsSection searchQuery={props.searchQuery} />

      <SubHeader label="Extensions" testid="subheader-extensions" />
      <MarketplaceTab />
      <PluginsSettings />
      <TemplateModelSettings templates={props.templates ?? []} />

      {hasUpdates && (
        <>
          <SubHeader label="Updates" testid="subheader-updates" />
          {renderRows(updatesKeys, props)}
        </>
      )}

      <SubHeader label="Setup" testid="subheader-setup" />
      <SetupChecklist
        onRestartOnboarding={() => {
          props.onRestartOnboarding?.();
        }}
        onNavigate={(cat) => {
          props.onNavigate(cat as SectionCategory);
        }}
      />
      {hasOnboard && renderRows(onboardKeys, props)}

      <SubHeader label="Advanced" testid="subheader-advanced" />
      <AdvancedSettings />
      <MobileSettings />

      {hasAbout && (
        <>
          <SubHeader label="About" testid="subheader-about" />
          <AboutHeader />
          {renderRows(aboutKeys, props)}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main modal
// ---------------------------------------------------------------------------

export function SettingsModal({ open, onOpenChange, onAction, auditEntries, templates, initialCategory, onRestartOnboarding }: SettingsModalProps) {
  const { t } = useTranslation();

  // Resolve any legacy alias to the canonical section on mount
  const resolveInitial = (cat?: SettingCategory): SectionCategory =>
    cat ? resolveSection(cat) : 'workspace';

  const [activeSection, setActiveSection] = useState<SectionCategory>(resolveInitial(initialCategory));

  const templateUpdateCount = useTemplateUpdateCount();
  const pluginUpdateCount = usePluginUpdateCount();
  const marketplaceUpdateCount = templateUpdateCount + pluginUpdateCount;
  const [searchQuery, setSearchQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Re-apply initialCategory each time the modal opens (deep-link support)
  const prevOpen = useRef(open);
  useEffect(() => {
    if (open && !prevOpen.current && initialCategory) {
      setActiveSection(resolveSection(initialCategory));
    }
    prevOpen.current = open;
  }, [open, initialCategory]);

  const { getSetting, setSetting, resetAll, exportSettings, importSettings } =
    useSettingsStore();

  // Keys that match the current search query
  const filteredKeys = useMemo<Set<string>>(() => {
    const lowerQ = searchQuery.toLowerCase().trim();
    if (!lowerQ) {
      return new Set(SETTINGS_SCHEMA.map((d) => d.key));
    }
    return new Set(
      SETTINGS_SCHEMA
        .filter(
          (def) =>
            def.label.toLowerCase().includes(lowerQ) ||
            def.description.toLowerCase().includes(lowerQ) ||
            def.key.toLowerCase().includes(lowerQ)
        )
        .map((d) => d.key)
    );
  }, [searchQuery]);

  // Which sections have at least one visible setting after filtering
  const visibleSections = useMemo<Set<SectionCategory>>(() => {
    // When no search: all sections visible
    if (!searchQuery.trim()) {
      return new Set<SectionCategory>(['workspace', 'ai-privacy', 'account', 'voice', 'advanced-help']);
    }
    const sections = new Set<SectionCategory>();
    for (const def of SETTINGS_SCHEMA) {
      if (filteredKeys.has(def.key)) {
        // resolveSection handles both canonical and legacy ids
        const sec = resolveSection(def.category);
        sections.add(sec);
      }
    }
    const lowerQ = searchQuery.toLowerCase();
    // Shortcut text is not in SETTINGS_SCHEMA — include advanced-help if any shortcut matches
    const anyShortcutMatch = SHORTCUTS.some(
      (s) =>
        s.label.toLowerCase().includes(lowerQ) ||
        (s.description ?? '').toLowerCase().includes(lowerQ) ||
        s.keys.some((k) => k.toLowerCase().includes(lowerQ))
    );
    if (anyShortcutMatch) sections.add('advanced-help');
    // Always show account for cost/license/firm/integration keywords
    const accountKeywords = ['cost', 'usage', 'spend', 'budget', 'month', 'license', 'activate',
      'personal', 'professional', 'practice', 'paid', 'firm', 'seat',
      'collaborat', 'matter', 'admin', 'team', 'mcp', 'integration',
      'sidecar', 'bundle', 'email', 'mail', 'microsoft', '365', 'outlook',
      'ollama', 'local model'];
    if (accountKeywords.some((k) => lowerQ.includes(k))) sections.add('account');
    // Privacy keywords always show ai-privacy
    const aiPrivacyKeywords = ['privacy', 'telemetry', 'tracking', 'data', 'anonymous', 'opt',
      'memory', 'fact', 'pdf', 'ocr', 'confidential', 'privileged'];
    if (aiPrivacyKeywords.some((k) => lowerQ.includes(k))) sections.add('ai-privacy');
    return sections;
  }, [filteredKeys, searchQuery]);

  // Auto-switch to first visible section when search hides the current one
  const effectiveSection = visibleSections.has(activeSection)
    ? activeSection
    : (SETTING_CATEGORIES.find((c) => visibleSections.has(c.id))?.id ?? 'workspace');

  if (effectiveSection !== activeSection) {
    queueMicrotask(() => setActiveSection(effectiveSection));
  }

  const handleExport = useCallback(() => {
    const json = exportSettings();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'keepance-settings.json';
    a.click();
    URL.revokeObjectURL(url);
  }, [exportSettings]);

  const handleImport = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleImportFile = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        const text = reader.result as string;
        const ok = importSettings(text);
        if (!ok) {
          alert('Failed to import settings. The file may be invalid.');
        }
      };
      reader.readAsText(file);
      e.target.value = '';
    },
    [importSettings]
  );

  const handleReset = useCallback(() => {
    if (window.confirm('Reset all settings to their defaults? This cannot be undone.')) {
      resetAll();
    }
  }, [resetAll]);

  const [showApiKeyTutorial, setShowApiKeyTutorial] = useState(false);

  const handleAction = useCallback(
    (actionId: string) => {
      if (actionId === 'open-api-key-tutorial') {
        setShowApiKeyTutorial(true);
        return;
      }
      onOpenChange(false);
      onAction?.(actionId);
    },
    [onAction, onOpenChange]
  );

  const sectionProps: SectionProps = {
    getSetting,
    setSetting,
    onAction: handleAction,
    filteredKeys,
    searchQuery,
    auditEntries,
    templates,
    onRestartOnboarding,
    onNavigate: setActiveSection,
  };

  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-testid="settings-modal"
        className="max-w-3xl w-[90vw] h-[80vh] max-h-[700px] p-0 flex flex-col overflow-hidden [&>button]:hidden"
      >
        <DialogTitle className="sr-only">{t('settings.modal.title')}</DialogTitle>
        <DialogDescription className="sr-only">
          {t('settings.modal.description')}
        </DialogDescription>

        {/* Header / Search */}
        <div className="shrink-0 border-b px-4 py-3 flex items-center gap-3">
          <h2 className="text-base font-semibold shrink-0">{t('settings.modal.title')}</h2>
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            <Input
              ref={searchRef}
              data-testid="settings-search"
              placeholder={t('settings.modal.search-placeholder')}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 pr-8 h-8 text-sm"
            />
            {searchQuery && (
              <button
                type="button"
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                onClick={() => setSearchQuery('')}
                aria-label={t('settings.modal.clear-search-aria')}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0"
            onClick={() => onOpenChange(false)}
            aria-label={t('settings.modal.close-aria')}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Body: sidebar + content */}
        <div className="flex flex-1 min-h-0 overflow-hidden">
          {/* Section sidebar — 5 entries */}
          <nav className="w-48 shrink-0 border-r py-2 overflow-y-auto bg-muted/20">
            {SETTING_CATEGORIES.map((sec) => {
              const visible = visibleSections.has(sec.id);
              if (!visible) return null;
              const isActive = activeSection === sec.id;
              const showUpdateBadge = sec.id === 'advanced-help' && marketplaceUpdateCount > 0;
              return (
                <button
                  key={sec.id}
                  data-testid={`settings-category-${sec.id}`}
                  className={cn(
                    'w-full flex items-center gap-2 text-left px-4 py-2 text-sm transition-colors',
                    isActive
                      ? 'bg-background font-medium text-foreground'
                      : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                  )}
                  onClick={() => setActiveSection(sec.id)}
                >
                  <span className="flex-1 truncate">{sec.label}</span>
                  {showUpdateBadge && (
                    <span
                      data-testid="settings-marketplace-update-badge"
                      data-count={marketplaceUpdateCount}
                      aria-label={t('settings.modal.marketplace-badge-aria', { count: marketplaceUpdateCount })}
                      className="shrink-0 inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1.5 rounded-full text-[10px] font-medium bg-primary/15 text-primary"
                    >
                      {marketplaceUpdateCount}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>

          {/* Content area */}
          <div className="flex-1 overflow-y-auto px-6 py-4">
            {activeSection === 'workspace' ? (
              <WorkspaceSection {...sectionProps} />
            ) : activeSection === 'ai-privacy' ? (
              <AiPrivacySection {...sectionProps} />
            ) : activeSection === 'account' ? (
              <AccountSection {...sectionProps} />
            ) : activeSection === 'voice' ? (
              <VoiceSection {...sectionProps} />
            ) : (
              <AdvancedHelpSection {...sectionProps} />
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="shrink-0 border-t px-4 py-3 flex items-center justify-end gap-2">
          <Button
            data-testid="settings-export"
            variant="outline"
            size="sm"
            className="gap-1.5 text-xs"
            onClick={handleExport}
          >
            <Download className="h-3 w-3" />
            {t('settings.modal.export')}
          </Button>
          <Button
            data-testid="settings-import"
            variant="outline"
            size="sm"
            className="gap-1.5 text-xs"
            onClick={handleImport}
          >
            <Upload className="h-3 w-3" />
            {t('settings.modal.import')}
          </Button>
          <Button
            data-testid="settings-reset"
            variant="outline"
            size="sm"
            className="gap-1.5 text-xs text-destructive hover:text-destructive"
            onClick={handleReset}
          >
            <RotateCcw className="h-3 w-3" />
            {t('settings.modal.reset')}
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json"
            className="hidden"
            onChange={handleImportFile}
          />
        </div>
      </DialogContent>
    </Dialog>
    {showApiKeyTutorial && (
      <ApiKeyWizard
        open={showApiKeyTutorial}
        onOpenChange={(v) => setShowApiKeyTutorial(v)}
        onSaveKey={() => { /* no-op: tutorial-only mode */ }}
        tutorialOnly
      />
    )}
    </>
  );
}

export default SettingsModal;
