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
  Children,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from 'react';
import { useTranslation } from 'react-i18next';
import { Input } from '@/ui/input';
import { Label } from '@/ui/label';
import { Button, IconButton, SearchField, Badge, Eyebrow, SurfaceToolbar } from '@/ui/kp';
import { cn } from '@/lib/utils';
import {
  SETTINGS_SCHEMA,
  SETTING_CATEGORIES,
  resolveSection,
  type SettingCategory,
  type SectionCategory,
  type SettingDefinition,
} from '@/platform/settings/schema';
import { useSettingsStore } from '@/platform/settings/settingsStore';
import {
  isLimitExceedingCapability,
  getMaxContextTokens,
  formatContextSize,
} from '@/platform/providers/context-limits';
import { TemplateModelSettings } from '@/features/settings/TemplateModelSettings';
import { PrivacySettings } from '@/features/settings/PrivacySettings';
import { ConfidentialityModeSettings } from '@/features/settings/ConfidentialityModeSettings';
import { LocalAiSettingsControl } from '@/features/settings/LocalAiSettingsControl';
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
} from 'lucide-react';
import { SurfaceHeader } from '@/ui/SurfaceHeader';
import {
  settingTestid,
  SETTINGS_GROUP_SEARCH,
  groupKeywordMatch,
} from './settingsContentHelpers';
import {
  Toggle,
  NumberStepper,
  AboutHeader,
} from './settingsContentPrimitives';

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
 * SubSection — one settings group. Its header label is rendered by the parent
 * AccordionSection as a horizontal tab; this component just renders the group's
 * content when its tab is active. `id` / `label` / `containsMatch` are read by
 * the parent (via child inspection) to build the tab strip and decide search
 * matches; they are not used in this component's own render.
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
 * AccordionSection — despite the legacy name, renders a top-level section's
 * sub-sections as a row of horizontal tabs with one content panel below,
 * instead of an accordion. It reads each SubSection child's props
 * (id / label / testid / containsMatch) to build the tab strip. The first tab
 * is selected by default; while a search is active it jumps to the first
 * matching tab and dims the non-matching ones. The tab button keeps the
 * `${testid}-heading` test id (and an inner `${testid}` on the label) so the
 * existing `subheader-*` selectors still resolve.
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

  const [activeId, setActiveId] = useState<string>(items[0]?.id ?? '');

  const lowerQ = searchQuery.toLowerCase().trim();
  const isMatch = (it: { id: string; label: string; containsMatch: boolean }): boolean =>
    it.containsMatch || groupKeywordMatch(it.id, it.label, lowerQ);

  // While searching, show the first matching tab; otherwise keep the user's
  // selection (falling back to the first tab if it no longer exists).
  const firstMatchId = searchActive ? items.find(isMatch)?.id : undefined;
  const effectiveActive =
    firstMatchId ?? (items.some((i) => i.id === activeId) ? activeId : items[0]?.id ?? '');
  const activeItem = items.find((i) => i.id === effectiveActive);

  return (
    <div>
      <div role="tablist" className="flex flex-wrap gap-1 border-b border-border/60 mb-5">
        {items.map((it) => {
          const active = it.id === effectiveActive;
          const dim = searchActive && !isMatch(it);
          return (
            <button
              key={it.id}
              type="button"
              role="tab"
              aria-selected={active}
              {...(it.testid ? { 'data-testid': `${it.testid}-heading` } : {})}
              onClick={() => { setActiveId(it.id); }}
              className={cn(
                'px-3 py-2 -mb-px border-b-2 transition-colors',
                'text-xs font-semibold uppercase tracking-wide',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-t-sm',
                active
                  ? 'border-[var(--kp-navy)] text-[var(--kp-navy)]'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
                dim && 'opacity-40'
              )}
            >
              <span {...(it.testid ? { 'data-testid': it.testid } : {})}>{it.label}</span>
            </button>
          );
        })}
      </div>
      <div>{activeItem?.node}</div>
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
      <AccordionSection ids={['aip-ai', 'aip-memory', 'aip-privacy']} searchActive={props.searchActive} searchQuery={props.searchQuery}>
        <SubSection
          id="aip-ai"
          label="AI"
          testid="subheader-ai"
          containsMatch={aiMatch}
        >
          <ConfidentialityModeSettings />
          <LocalAiSettingsControl />
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
  // Power-user / developer-view toggles (e.g. the AI cost & usage meters,
  // which are off by default so the assistant doesn't read like a dev console).
  const advancedKeys = ['showAiCostMeters'];

  const lowerQ = props.searchQuery.toLowerCase();
  const extMatch = !props.searchActive
    || ['extension', 'plugin', 'template', 'marketplace', 'model'].some((kw) => lowerQ.includes(kw));
  const advMatch = !props.searchActive
    || ['advanced', 'mobile', 'developer', 'debug', 'experimental'].some((kw) => lowerQ.includes(kw));

  return (
    <div data-testid="section-advanced">
      <AccordionSection ids={['adv-extensions', 'adv-updates', 'adv-advanced']} searchActive={props.searchActive} searchQuery={props.searchQuery}>
        <SubSection
          id="adv-extensions"
          label="Extensions"
          testid="subheader-extensions"
          containsMatch={extMatch}
        >
          {/* eslint-disable keepance-i18n/no-hardcoded-string */}
          <div className="space-y-8">
            <div className="space-y-3">
              <Eyebrow primary>Browse and install</Eyebrow>
              <MarketplaceTab />
            </div>
            <div className="space-y-3 border-t border-border/50 pt-6">
              <Eyebrow primary>Per-workflow AI model</Eyebrow>
              <TemplateModelSettings templates={props.templates ?? []} />
            </div>
          </div>
          {/* eslint-enable keepance-i18n/no-hardcoded-string */}
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
          containsMatch={advMatch || anyMatch(advancedKeys, props)}
        >
          {renderRows(advancedKeys, props)}
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
      <AccordionSection ids={['adv-shortcuts', 'adv-setup', 'adv-about']} searchActive={props.searchActive} searchQuery={props.searchQuery}>
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
  extraSections,
}: SettingsContentProps) {
  const { t } = useTranslation();

  // Resolve any legacy alias to the canonical section on mount
  const resolveInitial = (cat?: SettingCategory): SectionCategory =>
    cat ? resolveSection(cat) : 'workspace';

  const [activeSection, setActiveSection] = useState<SectionCategory>(resolveInitial(initialCategory));

  // Which nested "extra" section (Privacy Center / Activity Log) is open, or
  // null when a normal settings section is shown. Lives outside the
  // SectionCategory machinery so the schema-driven search/scoring is untouched.
  const [activeExtraId, setActiveExtraId] = useState<string | null>(null);

  const templateUpdateCount = useTemplateUpdateCount();
  const marketplaceUpdateCount = templateUpdateCount;
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

  // A nested "extra" section is being viewed only when one is selected AND no
  // search is active (typing a query always shows the schema-driven settings
  // results, never an extra surface). `activeExtra` is the section to render.
  const viewingExtra = activeExtraId !== null && !searchActive;
  const activeExtra = viewingExtra
    ? (extraSections ?? []).find((s) => s.id === activeExtraId)
    : undefined;

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

  // Relevance score per top-level section. Strong matches (a field label/key, or
  // a group's keyword/label) outrank a description-only hit, so "plug" lands on
  // Extensions (keyword) rather than an AI field that merely mentions "plugins"
  // in its description, and "language" lands on General rather than Voice.
  const sectionScores = useMemo<Record<SectionCategory, number>>(() => {
    const scores: Record<SectionCategory, number> = {
      workspace: 0, 'ai-privacy': 0, voice: 0, advanced: 0, help: 0,
    };
    const lowerQ = searchQuery.toLowerCase().trim();
    if (!lowerQ) return scores;
    const bump = (sec: SectionCategory, v: number) => { if (v > scores[sec]) scores[sec] = v; };
    for (const def of SETTINGS_SCHEMA) {
      const sec = resolveSection(def.category);
      if (def.label.toLowerCase().includes(lowerQ)) bump(sec, 3);
      else if (def.key.toLowerCase().includes(lowerQ)) bump(sec, 2);
      else if (def.description.toLowerCase().includes(lowerQ)) bump(sec, 1);
    }
    for (const [subId, entry] of Object.entries(SETTINGS_GROUP_SEARCH)) {
      if (groupKeywordMatch(subId, '', lowerQ)) bump(entry.section, 3);
    }
    // Keyboard-shortcut labels live outside the schema; a hit shows Help.
    const shortcutHit = SHORTCUTS.some(
      (s) =>
        s.label.toLowerCase().includes(lowerQ) ||
        (s.description ?? '').toLowerCase().includes(lowerQ) ||
        s.keys.some((k) => k.toLowerCase().includes(lowerQ))
    );
    if (shortcutHit) bump('help', 2);
    return scores;
  }, [searchQuery]);

  // Which sections have any match (score > 0).
  const visibleSections = useMemo<Set<SectionCategory>>(() => {
    if (!searchQuery.trim()) {
      return new Set<SectionCategory>(['workspace', 'ai-privacy', 'voice', 'advanced', 'help']);
    }
    const sections = new Set<SectionCategory>();
    (Object.keys(sectionScores) as SectionCategory[]).forEach((sec) => {
      if (sectionScores[sec] > 0) sections.add(sec);
    });
    return sections;
  }, [sectionScores, searchQuery]);

  // While searching, jump to the strongest-matching section, but stay put if the
  // current section is already a top match (so typing doesn't yank you around).
  const effectiveSection: SectionCategory = (() => {
    if (!searchActive) return activeSection;
    const order: SectionCategory[] = ['workspace', 'ai-privacy', 'voice', 'advanced', 'help'];
    const maxScore = Math.max(...order.map((s) => sectionScores[s]));
    if (maxScore <= 0) return activeSection;
    if (sectionScores[activeSection] === maxScore) return activeSection;
    return order.find((s) => sectionScores[s] === maxScore) ?? activeSection;
  })();

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
              const isActive = !viewingExtra && activeSection === sec.id;
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
                  onClick={(e) => { e.stopPropagation(); setActiveExtraId(null); setActiveSection(sec.id); }}
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

            {/* Nested surfaces (Privacy Center / Activity Log) appended below
                the schema sections, separated by a divider so they read as
                distinct destinations rather than more preferences. */}
            {extraSections && extraSections.length > 0 && (
              <>
                <div className="my-2 mx-6 border-t border-border/60" aria-hidden="true" />
                {extraSections.map((sec) => {
                  const isActive = viewingExtra && activeExtraId === sec.id;
                  return (
                    <button
                      key={sec.id}
                      data-testid={sec.testid}
                      aria-current={isActive ? 'page' : undefined}
                      className={cn(
                        'w-full flex items-center gap-2 text-left px-6 py-2.5 text-sm transition-colors',
                        isActive
                          ? 'bg-background font-medium text-foreground'
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

          {/* Content area */}
          <div
            ref={contentScrollRef}
            data-testid="settings-content-scroll"
            className="flex-1 overflow-y-auto px-8 py-6"
          >
            {activeExtra ? (
              activeExtra.content
            ) : activeSection === 'workspace' ? (
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
