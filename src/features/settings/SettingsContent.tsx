/**
 * SettingsContent — the reusable inner body of Settings.
 *
 * Rendered two ways:
 *   - Inside <SettingsModal> as a quick Dialog (gear icon, Ctrl+, , deep-links).
 *   - Full-page in the main window as the "Settings" nav tab (under Activity Log).
 *
 * Layout:
 *   Left sidebar  — section nav (Workspace / AI / Privacy / Voice / Advanced / Help)
 *   Right content — a simple vertical stack of short section groups.
 *   Top           — cross-section search bar + rare actions menu.
 *
 * Behavior preserved from the original SettingsModal:
 *   - Deep-link aliases: any legacy category id (general, ai, integrations…)
 *     resolves to the correct section via CATEGORY_ALIAS_MAP / resolveSection.
 *   - Cross-section search filters controls and auto-switches sections.
 *   - Export / Import / Reset.
 *
 * Added behavior:
 *   - The right content area scroll position resets to top on section change.
 */

import {
  useState,
  useCallback,
  useEffect,
  useRef,
  useMemo,
  Children,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from 'react';
import { useTranslation } from 'react-i18next';
import { Input } from '@/ui/input';
import { Label } from '@/ui/label';
import { Button, IconButton, SearchField, Badge, Eyebrow, RailShellHeader } from '@/ui/kp';
import { cn } from '@/lib/utils';
import {
  SETTINGS_SCHEMA,
  resolveSection,
  type SettingCategory,
  type SectionCategory,
  type SettingDefinition,
} from '@/platform/settings/schema';
import { useSettingsStore } from '@/platform/settings/settingsStore';
import { useFlagRegistryVersion } from '@/platform/flags';
import {
  isLimitExceedingCapability,
  getMaxContextTokens,
  formatContextSize,
} from '@/platform/providers/context-limits';
import { TemplateModelSettings } from '@/features/settings/TemplateModelSettings';
import { PrivacySettings } from '@/features/settings/PrivacySettings';
import { ConfidentialityModeSettings } from '@/features/settings/ConfidentialityModeSettings';
import { RecordingNoticeSettings } from '@/features/settings/RecordingNoticeSettings';
import { SchedulingSettings } from '@/features/scheduling/SchedulingSettings';
import { MemoryFactsSettings } from '@/features/settings/MemoryFactsSettings';
import { MarketplaceTab } from '@/features/workflows/marketplace/MarketplaceTab';
import { useTemplateUpdateCount } from '@/features/workflows/useTemplatesMarketplace';
import { MobileSettings } from '@/features/settings/MobileSettings';
import { AdvancedSettings } from '@/features/settings/AdvancedSettings';
import { VoiceSettingsSection } from '@/features/settings/VoiceSettingsSection';
import { LanguagePicker } from '@/features/settings/LanguagePicker';
import { SetupChecklist } from '@/features/settings/SetupChecklist';
import { ApiKeyWizard } from '@/features/onboarding/ApiKeyWizard';
import type { AuditEntry } from '@/platform/types/audit';
import type { WorkflowTemplate } from '@/platform/types/workflow';
import {
  SHORTCUTS,
  groupShortcutsByCategory,
  formatShortcutHint,
  isMac,
} from '@/platform/utils/shortcuts';
import {
  X,
  Upload,
  Download,
  RotateCcw,
  ExternalLink,
  Settings,
  MoreVertical,
  PanelLeftClose,
  PanelLeftOpen,
} from 'lucide-react';
import { SurfaceHeader } from '@/ui/SurfaceHeader';
import { InfoHelp } from '@/ui/InfoHelp';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/ui/dropdown-menu';
import { settingTestid, groupKeywordMatch } from './settingsContentHelpers';
import {
  getSettingsSearchActiveSection,
  getSettingsSearchResults,
} from './settingsSearch';
import { getVisibleSettingsSectionDescriptors } from './registry/settingsModuleRegistry';
import {
  registerSettingsSectionRenderer,
  renderRegisteredSettingsPanels,
} from './registry/sectionRendererBindings';
import type { SettingsSectionRenderProps } from './registry/types';
import {
  Toggle,
  NumberStepper,
  AboutHeader,
} from './settingsContentPrimitives';
import { useConfirmDialog } from '@/platform/hooks/useConfirmDialog';
import { ConfirmDialog } from '@/ui/ConfirmDialog';

const INLINE_DESCRIPTION_KEYS = new Set([
  'autoSaveInterval',
  'letterheadTemplatePath',
  'showHiddenFiles',
]);

const SETTINGS_MARKETPLACE_LIVE =
  import.meta.env['VITE_SETTINGS_MARKETPLACE_LIVE'] === '1';

function numberUnitForSetting(key: string): string | undefined {
  if (key === 'autoSaveInterval') return 'seconds';
  return undefined;
}

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
  /** Whether a workspace is open. AI rules need a workspace file to edit. */
  hasWorkspaceOpen?: boolean | undefined;
  /**
   * Extra, non-schema nav sections appended after the 5 settings sections.
   * The gear opens the Settings screen and Privacy Center + Activity Log are
   * nested as sections here. Each renders an arbitrary surface; the content is
   * supplied by the caller so SettingsContent stays decoupled from those
   * surfaces' data wiring. Optional — the modal variant omits it.
   */
  extraSections?: Array<{
    id: string;
    label: string;
    testid: string;
    content: ReactNode;
  }> | undefined;
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
  hasWorkspaceOpen,
}: {
  def: SettingDefinition;
  value: unknown;
  onChange: (v: unknown) => void;
  onAction?: (actionId: string) => void;
  hasWorkspaceOpen: boolean;
}) {
  const controlId = `setting-control-${def.key}`;
  const showHelp = shouldShowSettingHelp(def);

  // Action link (e.g. "Manage API Keys")
  if (def.action) {
    const actionDisabled = def.key === 'manageAIRules' && !hasWorkspaceOpen;
    const disabledHint = actionDisabled ? 'Open a workspace first' : undefined;
    const showInlineDescription = def.key === 'manageAIRules';

    return (
      <div
        data-testid={`setting-${def.key}`}
        className="flex items-center justify-between py-3 border-b border-border/50 last:border-b-0"
      >
        <div className="flex-1 min-w-0 mr-4">
          <div className="flex items-center gap-1.5">
            <Label className="text-sm font-medium">{def.label}</Label>
            {showHelp && <InfoHelp content={def.description} label={`About ${def.label}`} />}
          </div>
          {showInlineDescription && (
            <p className="mt-1 max-w-[34rem] text-xs leading-relaxed text-muted-foreground">
              {def.description}
            </p>
          )}
        </div>
        <div className="shrink-0 text-right">
          <Button
            variant="secondary"
            size="sm"
            iconRight={ExternalLink}
            className="shrink-0"
            disabled={actionDisabled}
            aria-describedby={disabledHint ? `${controlId}-hint` : undefined}
            onClick={() => { onAction?.(def.action?.actionId ?? ''); }}
          >
            {def.action.label}
          </Button>
          {disabledHint && (
            <p id={`${controlId}-hint`} className="mt-1 text-xs text-muted-foreground">
              {disabledHint}
            </p>
          )}
        </div>
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
          {...(numberUnitForSetting(def.key) ? { unit: numberUnitForSetting(def.key) } : {})}
        />
      );
      break;

    case 'text':
      control = (
        <Input
          id={controlId}
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => { onChange(e.target.value); }}
          {...(def.key === 'letterheadTemplatePath'
            ? { placeholder: 'Example: Firm Letterhead.docx' }
            : {})}
          className="max-w-[220px] h-8 text-sm"
        />
      );
      break;

    case 'shortcut-display':
      control = (
        <kbd
          id={controlId}
          className="inline-flex min-w-[132px] justify-center rounded-md border border-border bg-muted px-2.5 py-1.5 text-xs font-medium text-foreground"
        >
          {String(value ?? def.defaultValue)}
        </kbd>
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
        <div className="flex items-center gap-1.5">
          <Label htmlFor={controlId} className="text-sm font-medium cursor-pointer">
            {def.label}
          </Label>
          {showHelp && <InfoHelp content={def.description} label={`About ${def.label}`} />}
        </div>
        {INLINE_DESCRIPTION_KEYS.has(def.key) && (
          <p className="mt-1 max-w-[34rem] text-xs leading-relaxed text-muted-foreground">
            {def.description}
          </p>
        )}
      </div>
      <div className="shrink-0">{control}</div>
    </div>
  );
}

const HELP_SETTING_KEYS = new Set([
  'confidentialityMode',
  'privilegedMatterMode',
  'ambientFileContext',
  'ambientContextTokenLimit',
  'chatContextTokenLimit',
  'keepRecentTurns',
  'externalExportConsent',
  'externalExportStaleDays',
  'manageApiKeys',
  'manageAIRules',
  'letterheadTemplatePath',
  'showHiddenFiles',
  'memoryEnabled',
  'factsInjection',
  'factsAutoAccept',
  'aiFileApprovalMode',
  'includePdfsInWorkspaceIndex',
  'ocrScannedPdfs',
  'meetings.transcribeMode',
  'meetings.noticePolicy',
  'meetings.noticeScript',
  'meetings.noticeCardEnabled',
  'meetings.noticeCardNameTemplate',
  'meetings.noticeEvidenceRule',
]);

function shouldShowSettingHelp(def: SettingDefinition): boolean {
  if (def.action) return true;
  return HELP_SETTING_KEYS.has(def.key);
}

// ---------------------------------------------------------------------------
// Settings group stack
// ---------------------------------------------------------------------------

/**
 * SubSection — one settings group. Its header label is rendered by the parent
 * AccordionSection as a plain heading. `id` / `label` / `containsMatch` are
 * read by the parent (via child inspection) to decide search matches.
 */
interface SubSectionProps {
  id: string;
  label: string;
  testid?: string;
  /** False when a search is active and this group has no matching schema control. */
  containsMatch?: boolean;
  children: React.ReactNode;
}

function SubSection({ testid, children }: SubSectionProps) {
  return (
    <div data-testid={testid ? `subsection-${testid.replace(/^subheader-/, '')}` : undefined}>
      {children}
    </div>
  );
}

/**
 * AccordionSection — legacy name, now a simple vertical stack. The left rail is
 * the only navigation; these are just short headings inside the page.
 */
function AccordionSection({
  ids: _ids,
  searchActive,
  searchQuery,
  children,
}: {
  ids: string[];
  searchActive: boolean;
  searchQuery: string;
  children: React.ReactNode;
}) {
  const items = useMemo(
    () =>
      Children.toArray(children)
        .filter(isValidElement)
        .map((child) => {
          const p = (child as ReactElement<SubSectionProps>).props;
          return {
            id: p.id,
            label: p.label,
            testid: p.testid,
            containsMatch: p.containsMatch ?? true,
            node: child,
          };
        }),
    [children]
  );

  const lowerQ = searchQuery.toLowerCase().trim();
  const isMatch = (it: { id: string; label: string; containsMatch: boolean }): boolean =>
    it.containsMatch || groupKeywordMatch(it.id, it.label, lowerQ);
  const visibleItems = searchActive ? items.filter(isMatch) : items;

  return (
    <div className="space-y-8">
      {visibleItems.map((it) => (
        <section key={it.id} aria-labelledby={`${it.id}-heading`} className="space-y-3">
          <h2
            id={`${it.id}-heading`}
            {...(it.testid ? { 'data-testid': `${it.testid}-heading` } : {})}
            className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
          >
            <span {...(it.testid ? { 'data-testid': it.testid } : {})}>{it.label}</span>
          </h2>
          {it.node}
        </section>
      ))}
    </div>
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
                  <span className="inline-flex items-center gap-1.5 text-sm">
                    <span>{s.label}</span>
                    {s.description && (
                      <InfoHelp content={s.description} label={`About ${s.label}`} />
                    )}
                  </span>
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
// Section content renderers
// ---------------------------------------------------------------------------

export interface SettingsContentSectionProps extends SettingsSectionRenderProps {
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
  hasWorkspaceOpen: boolean;
}

/** Does any of `keys` survive the current search filter? Used to decide
 *  whether a search-active group should stay expanded. */
function anyMatch(keys: string[], props: SettingsContentSectionProps): boolean {
  if (!props.searchActive) return true;
  return keys.some((k) => props.filteredKeys.has(k));
}

function renderRows(
  keys: string[],
  props: SettingsContentSectionProps,
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
          hasWorkspaceOpen={props.hasWorkspaceOpen}
        />
      );
    });
}

export function WorkspaceSection(props: SettingsContentSectionProps) {
  const generalKeys = ['startupBehavior', 'showWhatsNew'];
  const editorKeys  = ['fontSize', 'autoSave', 'autoSaveInterval', 'wordWrap', 'lineNumbers'];
  const filesKeys   = ['defaultNewFileType', 'letterheadTemplatePath', 'trashRetention', 'showHiddenFiles'];

  return (
    <div data-testid="section-workspace">
      <AccordionSection ids={['ws-general', 'ws-editor', 'ws-files']} searchActive={props.searchActive} searchQuery={props.searchQuery}>
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
          label="Files"
          testid="subheader-files"
          containsMatch={anyMatch(filesKeys, props)}
        >
          {renderRows(filesKeys, props)}
        </SubSection>
      </AccordionSection>
    </div>
  );
}

export function AiSection(props: SettingsContentSectionProps) {
  // Token-limit keys go under a collapsed "Advanced" group (NEW-016): non-technical
  // advisors shouldn't see raw token numbers up front.
  const aiMainKeys     = ['ambientFileContext', 'keepRecentTurns', 'manageApiKeys', 'manageAIRules'];
  const aiAdvancedKeys = ['ambientContextTokenLimit', 'chatContextTokenLimit'];
  const memoryKeys = ['memoryEnabled', 'factsInjection', 'factsAutoAccept', 'includePdfsInWorkspaceIndex', 'ocrScannedPdfs'];
  // confidentialityMode and privilegedMatterMode are rendered by ConfidentialityModeSettings

  // Advanced section is collapsed by default; auto-expands when search matches a token-limit key.
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const advancedHasSearchMatch = props.searchActive && anyMatch(aiAdvancedKeys, props);
  const showAdvancedRows = advancedOpen || advancedHasSearchMatch;

  const aiMatch = anyMatch(['confidentialityMode', 'privilegedMatterMode', ...aiMainKeys, ...aiAdvancedKeys], props);

  return (
    <div data-testid="section-ai">
      <AccordionSection ids={['aip-ai', 'aip-memory']} searchActive={props.searchActive} searchQuery={props.searchQuery}>
        <SubSection
          id="aip-ai"
          label="AI"
          testid="subheader-ai"
          containsMatch={aiMatch}
        >
          <ConfidentialityModeSettings
            onManageApiKeys={() => {
              props.onAction('open-ai-keys');
            }}
          />
          {renderRows(aiMainKeys, props)}
          <AIContextCapabilityWarning getSetting={props.getSetting} />
          {/* Advanced — token limits: collapsed by default so non-technical users don't see raw numbers */}
          <div style={{ marginTop: 8 }}>
            <button
              type="button"
              data-testid="ai-advanced-toggle"
              onClick={() => { setAdvancedOpen((v) => !v); }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                fontSize: 'var(--kp-font-xs)',
                fontWeight: 'var(--kp-weight-semibold)',
                color: 'var(--color-muted-foreground)',
                background: 'none',
                border: 'none',
                padding: '4px 0',
                cursor: 'pointer',
              }}
              aria-expanded={showAdvancedRows}
            >
              <span style={{ fontSize: 10 }}>{showAdvancedRows ? '▲' : '▼'}</span>
              Advanced
            </button>
            {showAdvancedRows && renderRows(aiAdvancedKeys, props)}
          </div>
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
      </AccordionSection>
    </div>
  );
}

export function PrivacySection(props: SettingsContentSectionProps) {
  const noticeKeys = ['meetings.noticePolicy', 'meetings.noticeScript'];
  const lowerQ = props.searchQuery.toLowerCase();
  const privacyMatch = !props.searchActive
    || ['privacy', 'telemetry', 'tracking', 'data', 'anonymous', 'opt', 'consent', 'data map']
        .some((kw) => lowerQ.includes(kw));
  const noticeMatch = !props.searchActive
    || ['notice', 'recording', 'strict', 'standard', 'spoken', 'script', 'policy', 'meeting']
        .some((kw) => lowerQ.includes(kw))
    || anyMatch(noticeKeys, props);

  return (
    <div data-testid="section-privacy">
      <AccordionSection ids={['privacy-core', 'privacy-recording']} searchActive={props.searchActive} searchQuery={props.searchQuery}>
        <SubSection
          id="privacy-core"
          label="Privacy"
          testid="subheader-privacy"
          containsMatch={privacyMatch}
        >
          <PrivacySettings />
        </SubSection>
        <SubSection
          id="privacy-recording"
          label="Recording notice"
          testid="subheader-recording-notice"
          containsMatch={noticeMatch}
        >
          <RecordingNoticeSettings />
        </SubSection>
      </AccordionSection>
    </div>
  );
}

export function SchedulingSection(props: SettingsContentSectionProps) {
  const { t } = useTranslation();
  const lowerQ = props.searchQuery.toLowerCase();
  const schedulingMatch = !props.searchActive
    || ['schedule', 'scheduling', 'booking', 'availability', 'hours', 'buffer', 'timezone']
      .some((kw) => lowerQ.includes(kw));

  return (
    <div data-testid="section-scheduling">
      <AccordionSection ids={['scheduling-booking']} searchActive={props.searchActive} searchQuery={props.searchQuery}>
        <SubSection
          id="scheduling-booking"
          label={t('settings.scheduling.nav-subsection')}
          testid="subheader-scheduling"
          containsMatch={schedulingMatch}
        >
          <SchedulingSettings />
        </SubSection>
      </AccordionSection>
    </div>
  );
}

export function VoiceSection(props: SettingsContentSectionProps) {
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
      <AccordionSection ids={['voice-input', 'voice-tts']} searchActive={props.searchActive} searchQuery={props.searchQuery}>
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
          label="Text to speech"
          testid="subheader-tts"
          containsMatch={anyMatch(ttsKeys, props)}
        >
          {renderRows(ttsKeys, props)}
        </SubSection>
      </AccordionSection>
    </div>
  );
}

export function AdvancedSection(props: SettingsContentSectionProps) {
  const updatesKeys = ['autoUpdateCheck', 'updateChannel', 'manualCheckNow'];
  // Power-user / developer-view toggles (e.g. the AI cost & usage meters,
  // which are off by default so the assistant doesn't read like a dev console).
  const advancedKeys = ['showAiCostMeters'];

  const lowerQ = props.searchQuery.toLowerCase();
  const extMatch =
    SETTINGS_MARKETPLACE_LIVE &&
    (!props.searchActive ||
      ['extension', 'plugin', 'template', 'marketplace', 'model'].some((kw) =>
        lowerQ.includes(kw)
      ));
  const advMatch = !props.searchActive
    || ['advanced', 'mobile', 'developer', 'debug', 'experimental'].some((kw) => lowerQ.includes(kw));

  return (
    <div data-testid="section-advanced">
      <AccordionSection ids={['adv-extensions', 'adv-updates', 'adv-advanced']} searchActive={props.searchActive} searchQuery={props.searchQuery}>
        {SETTINGS_MARKETPLACE_LIVE && (
          <SubSection
            id="adv-extensions"
            label="Extensions"
            testid="subheader-extensions"
            containsMatch={extMatch}
          >
            {/* eslint-disable lantern-i18n/no-hardcoded-string */}
            <div className="space-y-3">
              <Eyebrow primary>Browse and install</Eyebrow>
              <MarketplaceTab />
            </div>
            {/* eslint-enable lantern-i18n/no-hardcoded-string */}
          </SubSection>
        )}
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
          containsMatch={advMatch || anyMatch(advancedKeys, props)}
        >
          <div className="mb-6 space-y-3">
            {/* eslint-disable-next-line lantern-i18n/no-hardcoded-string -- existing English-only advanced settings copy */}
            <Eyebrow primary>Per-workflow AI model</Eyebrow>
            <TemplateModelSettings templates={props.templates ?? []} />
          </div>
          {renderRows(advancedKeys, props)}
          <AdvancedSettings />
          <MobileSettings />
        </SubSection>
      </AccordionSection>
    </div>
  );
}

export function HelpSection(props: SettingsContentSectionProps) {
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
      <AccordionSection ids={['adv-setup', 'adv-shortcuts', 'adv-about']} searchActive={props.searchActive} searchQuery={props.searchQuery}>
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
          id="adv-shortcuts"
          label="Shortcuts"
          testid="subheader-shortcuts"
          containsMatch={anyShortcutMatch}
        >
          <ShortcutsSection searchQuery={props.searchQuery} />
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

// Compatibility registration for the existing section bodies. New feature
// modules register their descriptor and renderer beside the feature instead.
registerSettingsSectionRenderer('workspace', WorkspaceSection);
registerSettingsSectionRenderer('ai', AiSection);
registerSettingsSectionRenderer('privacy', PrivacySection);
registerSettingsSectionRenderer('scheduling', SchedulingSection);
registerSettingsSectionRenderer('voice', VoiceSection);
registerSettingsSectionRenderer('advanced', AdvancedSection);
registerSettingsSectionRenderer('help', HelpSection);

function SettingsActionsMenu({
  onExport,
  onImport,
  onReset,
}: {
  onExport: () => void;
  onImport: () => void;
  onReset: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton
          icon={MoreVertical}
          label="More settings actions"
          variant="secondary"
          size="md"
          data-testid="settings-actions-menu"
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuItem
          data-testid="settings-export"
          className="gap-2"
          onSelect={() => { onExport(); }}
        >
          <Download className="h-4 w-4" aria-hidden />
          Export settings
        </DropdownMenuItem>
        <DropdownMenuItem
          data-testid="settings-import"
          className="gap-2"
          onSelect={() => { onImport(); }}
        >
          <Upload className="h-4 w-4" aria-hidden />
          Import settings
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          data-testid="settings-reset"
          className="gap-2 text-destructive focus:text-destructive"
          onSelect={() => { onReset(); }}
        >
          <RotateCcw className="h-4 w-4" aria-hidden />
          Reset settings...
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
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
  hasWorkspaceOpen = true,
  extraSections,
}: SettingsContentProps) {
  const { t } = useTranslation();
  // Resolve any legacy alias to the canonical section on mount
  const resolveInitial = (cat?: SettingCategory): SectionCategory =>
    cat ? resolveSection(cat) : 'workspace';

  const [activeSection, setActiveSection] = useState<SectionCategory>(resolveInitial(initialCategory));
  const [railCollapsed, setRailCollapsed] = useState(false);

  // In-app confirm dialog (native window.confirm is dead in the Tauri WebView2
  // build, so the "reset settings" confirmation renders in the DOM instead).
  const { confirm, dialogProps: confirmDialogProps } = useConfirmDialog();

  // Which nested "extra" section (Privacy Center / Activity Log) is open, or
  // null when a normal settings section is shown. Lives outside the
  // SectionCategory machinery so the schema-driven search/scoring is untouched.
  const [activeExtraId, setActiveExtraId] = useState<string | null>(null);

  const templateUpdateCount = useTemplateUpdateCount();
  const marketplaceUpdateCount = SETTINGS_MARKETPLACE_LIVE ? templateUpdateCount : 0;
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
  }, [activeSection, activeExtraId]);

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
  useFlagRegistryVersion();
  // The registry is the rail's single source of truth. Empty feature sections
  // remain hidden, preserving today's screen until their first flag is on.
  const registeredSections = getVisibleSettingsSectionDescriptors();

  // A nested "extra" section is being viewed only when one is selected AND no
  // search is active (typing a query always shows the schema-driven settings
  // results, never an extra surface). `activeExtra` is the section to render.
  const viewingExtra = activeExtraId !== null && !searchActive;
  const activeExtra = viewingExtra
    ? (extraSections ?? []).find((s) => s.id === activeExtraId)
    : undefined;

  const { filteredKeys, sectionScores, visibleSectionIds: visibleSections } = useMemo(
    () => getSettingsSearchResults(searchQuery, registeredSections),
    [searchQuery, registeredSections],
  );

  // While searching, jump to the strongest-matching section, but stay put if the
  // current section is already a top match (so typing doesn't yank you around).
  const effectiveSection = getSettingsSearchActiveSection(
    activeSection,
    searchActive,
    registeredSections,
    sectionScores,
  );

  if (effectiveSection !== activeSection) {
    queueMicrotask(() => { setActiveSection(effectiveSection); });
  }

  const handleExport = useCallback(() => {
    const json = exportSettings();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'lantern-settings.json';
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
    void (async () => {
      const confirmed = await confirm('Reset all settings to their defaults? This cannot be undone.', {
        title: 'Reset settings',
        confirmLabel: 'Reset',
        variant: 'destructive',
      });
      if (confirmed) {
        resetAll();
      }
    })().catch((error: unknown) => {
      console.error('Could not reset Settings.', error);
    });
  }, [resetAll, confirm]);

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

  const sectionProps: SettingsContentSectionProps = {
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
    hasWorkspaceOpen,
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
          <div className="shrink-0 border-b px-8 pt-6 pb-4">
            <SurfaceHeader
              Icon={Settings}
              title={t('settings.modal.title')}
              testId="settings-surface-header"
            />
          </div>
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
            <SettingsActionsMenu
              onExport={handleExport}
              onImport={handleImport}
              onReset={handleReset}
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
          <aside
            className={cn(
              'flex shrink-0 flex-col border-r border-[var(--kp-divider)] bg-[var(--color-background)]',
              railCollapsed ? 'w-11 items-center py-2' : '',
            )}
            style={
              railCollapsed
                ? undefined
                : {
                    width: 'var(--kp-rail-width)',
                    minWidth: 'var(--kp-rail-width)',
                    maxWidth: 'var(--kp-rail-width)',
                  }
            }
          >
            {railCollapsed ? (
              <IconButton
                icon={PanelLeftOpen}
                label={t('settings.modal.show-sections')}
                size="sm"
                variant="ghost"
                data-testid="settings-rail-show"
                onClick={() => { setRailCollapsed(false); }}
              />
            ) : variant === 'page' ? (
              <RailShellHeader
                title={t('settings.modal.title')}
                search={{
                  value: searchQuery,
                  onChange: (v) => { setSearchQuery(v); },
                  onClear: () => { setSearchQuery(''); },
                  placeholder: t('settings.modal.search-placeholder'),
                  label: t('settings.modal.search-placeholder'),
                  testId: 'settings-search',
                  inputRef: searchRef,
                }}
                menuAction={(
                  <SettingsActionsMenu
                    onExport={handleExport}
                    onImport={handleImport}
                    onReset={handleReset}
                  />
                )}
                collapseAction={(
                  <IconButton
                    icon={PanelLeftClose}
                    label={t('settings.modal.hide-sections')}
                    size="sm"
                    variant="ghost"
                    data-testid="settings-rail-hide"
                    onClick={() => { setRailCollapsed(true); }}
                  />
                )}
              />
            ) : null}
            {!railCollapsed && (
            <nav aria-label="Settings sections" className="min-h-0 flex-1 overflow-y-auto py-3">
              {registeredSections.map((sec) => {
              const visible = visibleSections.has(sec.id);
              if (!visible) return null;
              const isActive = !viewingExtra && activeSection === sec.id;
              const showUpdateBadge = sec.id === 'advanced' && marketplaceUpdateCount > 0;
              return (
                <button
                  key={sec.id}
                  data-testid={`settings-category-${sec.id}`}
                  aria-current={isActive ? 'page' : undefined}
                  className={cn(
                    'relative mx-2 w-[calc(100%-1rem)] rounded-md flex items-center gap-2 text-left px-4 py-2.5 text-[length:var(--kp-rail-row-title-font-size)] transition-colors',
                    isActive
                      ? 'bg-primary/10 font-semibold text-primary shadow-sm'
                      : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                  )}
                  onClick={(e) => { e.stopPropagation(); setActiveExtraId(null); setActiveSection(sec.id); }}
                  >
                    <span className="flex-1 truncate">{t(sec.labelKey, sec.legacyLabel)}</span>
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

              {/* Extra surfaces (Privacy Center / Activity Log) use the same left rail. */}
              {extraSections && extraSections.length > 0 && (
                <>
                  {extraSections.map((sec) => {
                  const isActive = viewingExtra && activeExtraId === sec.id;
                  return (
                    <button
                      key={sec.id}
                      data-testid={sec.testid}
                      aria-current={isActive ? 'page' : undefined}
                      className={cn(
                        'relative mx-2 w-[calc(100%-1rem)] rounded-md flex items-center gap-2 text-left px-4 py-2.5 text-[length:var(--kp-rail-row-title-font-size)] transition-colors',
                        isActive
                          ? 'bg-primary/10 font-semibold text-primary shadow-sm'
                          : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                      )}
                      onClick={(e) => { e.stopPropagation(); setSearchQuery(''); setActiveExtraId(sec.id); }}
                    >
                      <span className="flex-1 truncate">{sec.label}</span>
                    </button>
                  );
                  })}
                </>
              )}
            </nav>
            )}
          </aside>

          {/* Content area */}
          <div
            ref={contentScrollRef}
            data-testid="settings-content-scroll"
            className="flex-1 min-h-0 overflow-y-auto px-8 py-6"
          >
            {activeExtra
              ? activeExtra.content
              : renderRegisteredSettingsPanels(activeSection, sectionProps)}
          </div>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept=".json"
          className="hidden"
          onChange={handleImportFile}
        />
      </div>
      {showApiKeyTutorial && (
        <ApiKeyWizard
          open={showApiKeyTutorial}
          onOpenChange={(v) => { setShowApiKeyTutorial(v); }}
          onSaveKey={() => { /* no-op: tutorial-only mode */ }}
          tutorialOnly
        />
      )}
      <ConfirmDialog {...confirmDialogProps} />
    </>
  );
}

export default SettingsContent;
