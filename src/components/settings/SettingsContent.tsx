/**
 * SettingsContent — the reusable inner body of Settings.
 *
 * Rendered two ways:
 *   - Inside <SettingsModal> as a quick Dialog (gear icon, Ctrl+, , deep-links).
 *   - Full-page in the main window as the "Settings" nav tab (under Activity Log).
 *
 * Layout:
 *   Left sidebar  — 5-section nav (Workspace / AI & Privacy / Voice / Advanced / Help)
 *   Right content — settings for the active section, grouped into COLLAPSIBLE
 *                   accordion sub-sections (one open at a time; first open by
 *                   default; a search match auto-expands the groups that match).
 *   Top           — cross-section search bar
 *   Bottom-right  — Export / Import / Reset buttons
 *
 * Behavior preserved from the original SettingsModal:
 *   - Deep-link aliases: any legacy category id (general, ai, integrations…)
 *     resolves to the correct section via CATEGORY_ALIAS_MAP / resolveSection.
 *   - Cross-section search filters controls and auto-switches sections.
 *   - Export / Import / Reset.
 *
 * Added behavior:
 *   - Accordion sub-sections (one open at a time, first default-open).
 *   - The right content area scroll position resets to top on section change.
 */

import {
  useState,
  useCallback,
  useEffect,
  useRef,
  useMemo,
  createContext,
  useContext,
} from 'react';
import { useTranslation } from 'react-i18next';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button, IconButton, SearchField, Badge, Eyebrow, SurfaceToolbar } from '@/components/ui/kp';
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
import { TemplateModelSettings } from '@/components/settings/TemplateModelSettings';
import { PrivacySettings } from '@/components/settings/PrivacySettings';
import { ConfidentialityModeSettings } from '@/components/settings/ConfidentialityModeSettings';
import { MemoryFactsSettings } from '@/components/settings/MemoryFactsSettings';
import { MarketplaceTab } from '@/components/marketplace/MarketplaceTab';
import { useTemplateUpdateCount } from '@/hooks/useTemplatesMarketplace';
import { usePluginUpdateCount } from '@/hooks/usePluginsMarketplace';
import { MobileSettings } from '@/components/settings/MobileSettings';
import { PluginsSettings } from '@/components/settings/PluginsSettings';
import { AdvancedSettings } from '@/components/settings/AdvancedSettings';
import { VoiceSettingsSection } from '@/components/settings/VoiceSettingsSection';
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
  X,
  Upload,
  Download,
  RotateCcw,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Settings,
} from 'lucide-react';
import { SurfaceHeader } from '@/components/layout/SurfaceHeader';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface SettingsContentProps {
  /** Callback when an action link is clicked (e.g., "Manage API Keys"). */
  onAction?: (actionId: string) => void;
  /**
   * Called by the modal wrapper to close the dialog before forwarding an
   * action (so the underlying panel is visible). Full-page usage passes a
   * no-op since there is no dialog to close.
   */
  onRequestClose?: () => void;
  /** Audit entries (reserved for future use; Account moved to AccountWindow). */
  auditEntries?: AuditEntry[] | undefined;
  /** Workflow templates for the per-template model table (Extensions). */
  templates?: WorkflowTemplate[] | undefined;
  /**
   * Which category (canonical section id OR legacy alias) to open on. Re-applied
   * whenever `initialCategory` changes (deep-link support); legacy ids resolve
   * via CATEGORY_ALIAS_MAP.
   */
  initialCategory?: SettingCategory | undefined;
  /** Called when the user clicks "Restart guided setup" in the setup checklist. */
  onRestartOnboarding?: (() => void) | undefined;
  /**
   * Visual variant. 'modal' keeps the dialog header chrome (title + close X);
   * 'page' renders a full-page surface header (eyebrow + title, no close X).
   */
  variant?: 'modal' | 'page';
  /** Optional close handler for the modal header X (modal variant only). */
  onClose?: (() => void) | undefined;
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
      onClick={() => { onChange(!checked); }}
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
      <IconButton
        icon={ChevronDown}
        label="Decrease"
        variant="secondary"
        size="sm"
        onClick={() => { onChange(clamp(value - step)); }}
        disabled={min !== undefined && value <= min}
      />
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
      <IconButton
        icon={ChevronUp}
        label="Increase"
        variant="secondary"
        size="sm"
        onClick={() => { onChange(clamp(value + step)); }}
        disabled={max !== undefined && value >= max}
      />
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
          variant="secondary"
          size="sm"
          iconRight={ExternalLink}
          className="shrink-0"
          onClick={() => { onAction?.(def.action?.actionId ?? ''); }}
        >
          {def.action.label}
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
          onChange={(v) => { onChange(v); }}
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
          onChange={(e) => { onChange(e.target.value); }}
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
          onChange={(v) => { onChange(v); }}
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
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => { onChange(e.target.value); }}
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
// Accordion sub-section
// ---------------------------------------------------------------------------

/**
 * Per-section accordion context. Each top-level section owns one of these so
 * that at most one sub-section is open at a time. All sub-sections are
 * collapsed by default; a search match forces matching groups open. Clicking
 * the already-open header collapses it (zero-open is valid).
 */
interface AccordionCtx {
  /** Currently open sub-section id, or '' when all are collapsed. */
  openId: string;
  /** Toggle a sub-section. Opening a closed one (also closes any currently
   *  open one). Clicking the already-open one collapses it to none. */
  open: (id: string) => void;
  /** When true, search is active — matching groups stay expanded regardless. */
  searchActive: boolean;
}

const AccordionContext = createContext<AccordionCtx | null>(null);

/**
 * SubSection — a collapsible accordion item. Replaces the old always-visible
 * <SubHeader>. The header keeps the SubHeader test id so existing assertions
 * on `subheader-*` continue to pass; the body unmounts when collapsed.
 *
 * `containsMatch` (search): while a search is active, this group expands iff it
 * has a matching control, and groups with no match are hidden so results stay
 * scannable.
 */
function SubSection({
  id,
  label,
  testid,
  containsMatch = true,
  children,
}: {
  id: string;
  label: string;
  testid?: string;
  /** False when a search is active and this group has no matching control. */
  containsMatch?: boolean;
  children: React.ReactNode;
}) {
  const ctx = useContext(AccordionContext);

  // When searching, expansion is driven entirely by whether this group matches.
  // When not searching, the single-open accordion state governs it.
  const isOpen = ctx
    ? ctx.searchActive
      ? containsMatch
      : ctx.openId === id && ctx.openId !== ''
    : true;

  // While searching, hide groups that have no match so results stay scannable.
  if (ctx && ctx.searchActive && !containsMatch) return null;

  const headingTestId = testid ? `${testid}-heading` : undefined;
  const searchActive = ctx?.searchActive ?? false;

  return (
    <div
      data-testid={testid ? `subsection-${testid.replace(/^subheader-/, '')}` : undefined}
      className="border-b border-border/40 last:border-b-0"
    >
      <button
        type="button"
        {...(headingTestId ? { 'data-testid': headingTestId } : {})}
        aria-expanded={isOpen}
        aria-controls={`${id}-body`}
        disabled={searchActive}
        onClick={() => { ctx?.open(id); }}
        className={cn(
          'w-full flex items-center justify-between gap-2 py-3 text-left group',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm',
          searchActive ? 'cursor-default' : 'cursor-pointer'
        )}
      >
        {/* The h3 keeps the original testid so `subheader-*` selectors resolve. */}
        <h3
          data-testid={testid}
          className="text-xs font-semibold text-muted-foreground uppercase tracking-wide group-hover:text-foreground transition-colors"
        >
          {label}
        </h3>
        <ChevronDown
          className={cn(
            'h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform',
            isOpen ? 'rotate-180' : 'rotate-0'
          )}
          aria-hidden="true"
        />
      </button>
      <div id={`${id}-body`} hidden={!isOpen} aria-live="polite" className="pb-4">
        {children}
      </div>
    </div>
  );
}

/**
 * AccordionSection — wraps a top-level section's sub-sections, owning the
 * "at most one open at a time / all collapsed by default" state. Because a
 * different section component mounts when the user switches top-level
 * sections, the open sub-section naturally resets to none on every section
 * change.
 *
 * `ids` lists the sub-section ids in render order (unused beyond
 * documentation now that none is default-open, kept for clarity).
 */
function AccordionSection({
  ids: _ids,
  searchActive,
  children,
}: {
  ids: string[];
  searchActive: boolean;
  children: React.ReactNode;
}) {
  // '' means all sub-sections are collapsed.
  const [openId, setOpenId] = useState<string>('');

  const open = useCallback((id: string) => {
    // Toggle: clicking the open sub-section collapses it; clicking a closed
    // one opens it (and implicitly closes any currently open one via state).
    setOpenId((prev) => (prev === id ? '' : id));
  }, []);

  const ctx = useMemo<AccordionCtx>(
    () => ({ openId, open, searchActive }),
    [openId, open, searchActive]
  );

  return (
    <AccordionContext.Provider value={ctx}>{children}</AccordionContext.Provider>
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
  /** True when a search query is active (controls accordion expansion). */
  searchActive: boolean;
  auditEntries?: AuditEntry[] | undefined;
  templates?: WorkflowTemplate[] | undefined;
  onRestartOnboarding?: (() => void) | undefined;
  onNavigate: (section: SectionCategory) => void;
}

/** Does any of `keys` survive the current search filter? Used to decide
 *  whether a search-active group should stay expanded. */
function anyMatch(keys: string[], props: SectionProps): boolean {
  if (!props.searchActive) return true;
  return keys.some((k) => props.filteredKeys.has(k));
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
          onChange={(v) => { props.setSetting(def.key, v); }}
          onAction={props.onAction}
        />
      );
    });
}

function WorkspaceSection(props: SectionProps) {
  const generalKeys = ['theme', 'startupBehavior', 'showWhatsNew'];
  const editorKeys  = ['tabOverflow', 'fontSize', 'autoSave', 'autoSaveInterval', 'wordWrap', 'lineNumbers'];
  const filesKeys   = ['defaultNewFileType', 'letterheadTemplatePath', 'trashRetention', 'showHiddenFiles'];

  return (
    <div data-testid="section-workspace">
      <AccordionSection ids={['ws-general', 'ws-editor', 'ws-files']} searchActive={props.searchActive}>
        <SubSection
          id="ws-general"
          label="General"
          testid="subheader-general"
          containsMatch={anyMatch(generalKeys, props)}
        >
          <LanguagePicker />
          {renderRows(generalKeys, props)}
        </SubSection>
        <SubSection
          id="ws-editor"
          label="Editor"
          testid="subheader-editor"
          containsMatch={anyMatch(editorKeys, props)}
        >
          {renderRows(editorKeys, props)}
        </SubSection>
        <SubSection
          id="ws-files"
          label="Files and Workspace"
          testid="subheader-files"
          containsMatch={anyMatch(filesKeys, props)}
        >
          {renderRows(filesKeys, props)}
        </SubSection>
      </AccordionSection>
    </div>
  );
}

function AiPrivacySection(props: SectionProps) {
  const aiKeys     = ['ambientFileContext', 'ambientContextTokenLimit', 'chatContextTokenLimit', 'keepRecentTurns', 'manageApiKeys', 'manageAIRules'];
  const memoryKeys = ['memoryEnabled', 'factsInjection', 'factsAutoAccept', 'includePdfsInWorkspaceIndex', 'ocrScannedPdfs'];
  // confidentialityMode and privilegedMatterMode are rendered by ConfidentialityModeSettings

  const aiMatch = anyMatch(['confidentialityMode', 'privilegedMatterMode', ...aiKeys], props);
  // Privacy has no schema keys (rendered by PrivacySettings); treat as a match
  // unless the search clearly has nothing AI/memory either (keep it reachable).
  const privacyMatch = !props.searchActive
    || ['privacy', 'telemetry', 'tracking', 'data', 'anonymous', 'opt']
        .some((kw) => props.searchQuery.toLowerCase().includes(kw));

  return (
    <div data-testid="section-ai-privacy">
      <AccordionSection ids={['aip-ai', 'aip-memory', 'aip-privacy']} searchActive={props.searchActive}>
        <SubSection
          id="aip-ai"
          label="AI"
          testid="subheader-ai"
          containsMatch={aiMatch}
        >
          <ConfidentialityModeSettings />
          {renderRows(aiKeys, props)}
          <AIContextCapabilityWarning getSetting={props.getSetting} />
        </SubSection>
        <SubSection
          id="aip-memory"
          label="Memory"
          testid="subheader-memory"
          containsMatch={anyMatch(memoryKeys, props)}
        >
          {renderRows(memoryKeys, props)}
          <MemoryFactsSettings />
        </SubSection>
        <SubSection
          id="aip-privacy"
          label="Privacy"
          testid="subheader-privacy"
          containsMatch={privacyMatch}
        >
          <PrivacySettings />
        </SubSection>
      </AccordionSection>
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

  return (
    <div data-testid="section-voice">
      <AccordionSection ids={['voice-input', 'voice-tts']} searchActive={props.searchActive}>
        <SubSection
          id="voice-input"
          label="Voice Input"
          testid="subheader-voice-input"
          containsMatch={anyMatch(voiceInputKeys, props)}
        >
          <VoiceSettingsSection ttsEnabled={ttsEnabled} />
          {renderRows(voiceInputKeys, props)}
        </SubSection>
        <SubSection
          id="voice-tts"
          label="Text to Speech"
          testid="subheader-tts"
          containsMatch={anyMatch(ttsKeys, props)}
        >
          {renderRows(ttsKeys, props)}
        </SubSection>
      </AccordionSection>
    </div>
  );
}

function AdvancedSection(props: SectionProps) {
  const updatesKeys = ['autoUpdateCheck', 'updateChannel', 'manualCheckNow'];

  const lowerQ = props.searchQuery.toLowerCase();
  const extMatch = !props.searchActive
    || ['extension', 'plugin', 'template', 'marketplace', 'model'].some((kw) => lowerQ.includes(kw));
  const advMatch = !props.searchActive
    || ['advanced', 'mobile', 'developer', 'debug', 'experimental'].some((kw) => lowerQ.includes(kw));

  return (
    <div data-testid="section-advanced">
      <AccordionSection ids={['adv-extensions', 'adv-updates', 'adv-advanced']} searchActive={props.searchActive}>
        <SubSection
          id="adv-extensions"
          label="Extensions"
          testid="subheader-extensions"
          containsMatch={extMatch}
        >
          <MarketplaceTab />
          <PluginsSettings />
          <TemplateModelSettings templates={props.templates ?? []} />
        </SubSection>
        <SubSection
          id="adv-updates"
          label="Updates"
          testid="subheader-updates"
          containsMatch={anyMatch(updatesKeys, props)}
        >
          {renderRows(updatesKeys, props)}
        </SubSection>
        <SubSection
          id="adv-advanced"
          label="Advanced"
          testid="subheader-advanced"
          containsMatch={advMatch}
        >
          <AdvancedSettings />
          <MobileSettings />
        </SubSection>
      </AccordionSection>
    </div>
  );
}

function HelpSection(props: SectionProps) {
  const onboardKeys = ['viewApiKeyTutorial', 'resetFeatureTour'];
  const aboutKeys   = ['aboutWhatsNew', 'aboutWebsite', 'aboutGithub'];

  const lowerQ = props.searchQuery.toLowerCase();
  const anyShortcutMatch = !props.searchActive || SHORTCUTS.some(
    (s) =>
      s.label.toLowerCase().includes(lowerQ) ||
      (s.description ?? '').toLowerCase().includes(lowerQ) ||
      s.keys.some((k) => k.toLowerCase().includes(lowerQ))
  );
  const setupMatch = !props.searchActive
    || anyMatch(onboardKeys, props)
    || ['setup', 'onboard', 'tour', 'guide', 'checklist'].some((kw) => lowerQ.includes(kw));

  return (
    <div data-testid="section-help">
      <AccordionSection ids={['adv-shortcuts', 'adv-setup', 'adv-about']} searchActive={props.searchActive}>
        <SubSection
          id="adv-shortcuts"
          label="Keyboard Shortcuts"
          testid="subheader-shortcuts"
          containsMatch={anyShortcutMatch}
        >
          <ShortcutsSection searchQuery={props.searchQuery} />
        </SubSection>
        <SubSection
          id="adv-setup"
          label="Setup"
          testid="subheader-setup"
          containsMatch={setupMatch}
        >
          <SetupChecklist
            onRestartOnboarding={() => {
              props.onRestartOnboarding?.();
            }}
            onNavigate={(cat) => {
              props.onNavigate(cat as SectionCategory);
            }}
          />
          {renderRows(onboardKeys, props)}
        </SubSection>
        <SubSection
          id="adv-about"
          label="About"
          testid="subheader-about"
          containsMatch={anyMatch(aboutKeys, props)}
        >
          <AboutHeader />
          {renderRows(aboutKeys, props)}
        </SubSection>
      </AccordionSection>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main reusable content
// ---------------------------------------------------------------------------

export function SettingsContent({
  onAction,
  onRequestClose,
  auditEntries,
  templates,
  initialCategory,
  onRestartOnboarding,
  variant = 'modal',
  onClose,
}: SettingsContentProps) {
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

  // R62.3 — the right content scroll container. Reset to top whenever the
  // active section changes so a deep-scrolled section never carries its
  // scroll position into the next one.
  const contentScrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (contentScrollRef.current) {
      contentScrollRef.current.scrollTop = 0;
    }
  }, [activeSection]);

  // Re-apply initialCategory whenever it changes (deep-link support). Uses the
  // React-sanctioned "adjust state during render when a prop changes" pattern
  // (https://react.dev/learn/you-might-not-need-an-effect) instead of an effect,
  // so the section updates in the same render the new deep-link arrives.
  const [prevInitialCategory, setPrevInitialCategory] = useState(initialCategory);
  if (initialCategory !== prevInitialCategory) {
    setPrevInitialCategory(initialCategory);
    if (initialCategory) {
      setActiveSection(resolveSection(initialCategory));
    }
  }

  const { getSetting, setSetting, resetAll, exportSettings, importSettings } =
    useSettingsStore();

  const searchActive = searchQuery.trim().length > 0;

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
      return new Set<SectionCategory>(['workspace', 'ai-privacy', 'voice', 'advanced', 'help']);
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
    // Shortcut text is not in SETTINGS_SCHEMA — include help if any shortcut matches
    const anyShortcutMatch = SHORTCUTS.some(
      (s) =>
        s.label.toLowerCase().includes(lowerQ) ||
        (s.description ?? '').toLowerCase().includes(lowerQ) ||
        s.keys.some((k) => k.toLowerCase().includes(lowerQ))
    );
    if (anyShortcutMatch) sections.add('help');
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
    queueMicrotask(() => { setActiveSection(effectiveSection); });
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
      onRequestClose?.();
      onAction?.(actionId);
    },
    [onAction, onRequestClose]
  );

  const sectionProps: SectionProps = {
    getSetting,
    setSetting,
    onAction: handleAction,
    filteredKeys,
    searchQuery,
    searchActive,
    auditEntries,
    templates,
    onRestartOnboarding,
    onNavigate: setActiveSection,
  };

  return (
    <>
      <div
        data-testid="settings-content"
        data-variant={variant}
        className={cn(
          'flex flex-col min-h-0 bg-background',
          variant === 'page' ? 'h-full w-full' : 'h-full'
        )}
      >
        {/* Header / Search — px-8 pt-6 pb-4 == 32px gutter × standard header pad,
            so the Settings title sits at the same height as every other tab and
            the horizontal rhythm matches --kp-gutter (32px). */}
        {variant === 'page' && (
          <>
            <div className="shrink-0 border-b px-8 pt-6 pb-4">
              <SurfaceHeader
                Icon={Settings}
                title="Settings"
                description="Everything about how Keepance works for you."
                testId="settings-surface-header"
              />
            </div>
            <SurfaceToolbar>
              <SearchField
                ref={searchRef}
                data-testid="settings-search"
                placeholder={t('settings.modal.search-placeholder')}
                value={searchQuery}
                onChange={(v) => { setSearchQuery(v); }}
                onClear={() => { setSearchQuery(''); }}
                size="md"
                style={{ flex: 1, minWidth: 240 }}
              />
            </SurfaceToolbar>
          </>
        )}
        {variant === 'modal' && (
          <div className="shrink-0 border-b px-8 py-4 flex items-center gap-3">
            <Eyebrow primary className="shrink-0">{t('settings.modal.title')}</Eyebrow>
            <SearchField
              ref={searchRef}
              data-testid="settings-search"
              placeholder={t('settings.modal.search-placeholder')}
              value={searchQuery}
              onChange={(v) => { setSearchQuery(v); }}
              onClear={() => { setSearchQuery(''); }}
              size="md"
            />
            <IconButton
              icon={X}
              label={t('settings.modal.close-aria')}
              variant="ghost"
              size="sm"
              onClick={() => { onClose?.(); }}
            />
          </div>
        )}

        {/* Body: sidebar + content */}
        <div className="flex flex-1 min-h-0 overflow-hidden">
          {/* Section sidebar — 5 sections */}
          <nav aria-label="Settings sections" className="w-48 shrink-0 border-r py-3 overflow-y-auto bg-muted/20">
            {SETTING_CATEGORIES.map((sec) => {
              const visible = visibleSections.has(sec.id);
              if (!visible) return null;
              const isActive = activeSection === sec.id;
              const showUpdateBadge = sec.id === 'advanced' && marketplaceUpdateCount > 0;
              return (
                <button
                  key={sec.id}
                  data-testid={`settings-category-${sec.id}`}
                  aria-current={isActive ? 'page' : undefined}
                  className={cn(
                    'w-full flex items-center gap-2 text-left px-6 py-2.5 text-sm transition-colors',
                    isActive
                      ? 'bg-background font-medium text-foreground'
                      : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                  )}
                  onClick={(e) => { e.stopPropagation(); setActiveSection(sec.id); }}
                >
                  <span className="flex-1 truncate">{sec.label}</span>
                  {showUpdateBadge && (
                    <Badge
                      variant="neutral"
                      size="sm"
                      data-testid="settings-marketplace-update-badge"
                      data-count={marketplaceUpdateCount}
                      aria-label={t('settings.modal.marketplace-badge-aria', { count: marketplaceUpdateCount })}
                      title={t('settings.modal.marketplace-badge-aria', { count: marketplaceUpdateCount })}
                    >
                      {marketplaceUpdateCount}
                    </Badge>
                  )}
                </button>
              );
            })}
          </nav>

          {/* Content area */}
          <div
            ref={contentScrollRef}
            data-testid="settings-content-scroll"
            className="flex-1 overflow-y-auto px-8 py-6"
          >
            {activeSection === 'workspace' ? (
              <WorkspaceSection {...sectionProps} />
            ) : activeSection === 'ai-privacy' ? (
              <AiPrivacySection {...sectionProps} />
            ) : activeSection === 'voice' ? (
              <VoiceSection {...sectionProps} />
            ) : activeSection === 'advanced' ? (
              <AdvancedSection {...sectionProps} />
            ) : (
              <HelpSection {...sectionProps} />
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="shrink-0 border-t px-8 py-4 flex items-center justify-end gap-2">
          <Button
            data-testid="settings-export"
            variant="secondary"
            size="sm"
            iconLeft={Download}
            onClick={handleExport}
          >
            {t('settings.modal.export')}
          </Button>
          <Button
            data-testid="settings-import"
            variant="secondary"
            size="sm"
            iconLeft={Upload}
            onClick={handleImport}
          >
            {t('settings.modal.import')}
          </Button>
          <Button
            data-testid="settings-reset"
            variant="danger"
            size="sm"
            iconLeft={RotateCcw}
            onClick={handleReset}
          >
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
      </div>
      {showApiKeyTutorial && (
        <ApiKeyWizard
          open={showApiKeyTutorial}
          onOpenChange={(v) => { setShowApiKeyTutorial(v); }}
          onSaveKey={() => { /* no-op: tutorial-only mode */ }}
          tutorialOnly
        />
      )}
    </>
  );
}

export default SettingsContent;
