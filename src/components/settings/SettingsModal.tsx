/**
 * SettingsModal — Full-screen settings dialog rendered from the schema.
 *
 * Layout:
 *   Left sidebar  — category nav
 *   Right content — settings for the active category, auto-rendered
 *   Top           — cross-category search bar
 *   Bottom-right  — Export / Import / Reset buttons
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
  type SettingCategory,
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
import { LanguagePicker } from '@/components/settings/LanguagePicker';
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
   * Q4 (Wave 1.2) — audit entries for the Cost & Usage category. When
   * omitted, the Cost & Usage dashboard renders with an empty array
   * (shows the zero-state copy and an all-zero 30-day chart).
   */
  auditEntries?: AuditEntry[];
  /**
   * Q8 (Wave 1.6) — workflow templates (built-ins + user-authored) used to
   * render the per-template model assignment table in the Templates
   * category. When omitted, the table shows an empty state.
   */
  templates?: WorkflowTemplate[];
  /**
   * Which category to open the modal on. Re-applied every time the modal
   * transitions from closed → open, so callers can deep-link to any
   * section (trial banner → 'license', "Manage API keys" → 'ai-keys', etc.)
   * without persisting state across opens.
   */
  initialCategory?: SettingCategory;
}

// ---------------------------------------------------------------------------
// Toggle switch (minimal inline implementation since shadcn switch isn't present)
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
// Stream A4 — inline capability warning for chatContextTokenLimit
// ---------------------------------------------------------------------------

function AIContextCapabilityWarning({
  getSetting,
}: {
  getSetting: (key: string) => unknown;
}) {
  const { t } = useTranslation();
  const chatLimitValue = (getSetting('chatContextTokenLimit') as number | undefined) ?? 200000;
  // We use a generic provider/model fallback — users who care about exact
  // capability will be on the AI Assistant Models tab where the model is known.
  // The settings panel shows a conservative warning based on what the user
  // configured as their default provider/model (if any).
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
// Keyboard shortcuts category (rendered from the SSOT)
// ---------------------------------------------------------------------------

function ShortcutsCategory({ searchQuery }: { searchQuery: string }) {
  const { t } = useTranslation();
  const grouped = useMemo(() => groupShortcutsByCategory(), []);
  const mac = isMac();
  const lowerQ = searchQuery.toLowerCase();

  // Filter shortcuts by search query
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
      {/* Prominent Ctrl+P tip */}
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
// About header — version + branding shown above the About settings list.
// ---------------------------------------------------------------------------

function AboutHeader() {
  const { t } = useTranslation();
  // VITE_APP_VERSION is injected by vite.config.ts (define plugin) so this
  // value matches whatever package.json was bundled. Falls back to '?' so
  // a missing define still renders something readable.
  const version =
    (import.meta.env['VITE_APP_VERSION'] as string | undefined) ?? '?';
  return (
    <div
      data-testid="settings-about-header"
      className="mb-4 pb-4 border-b border-border/50"
    >
      <div className="flex items-baseline gap-2">
        <h3 className="text-base font-semibold">Projelli</h3>
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
// Main modal
// ---------------------------------------------------------------------------

export function SettingsModal({ open, onOpenChange, onAction, auditEntries, templates, initialCategory }: SettingsModalProps) {
  const { t } = useTranslation();
  const [activeCategory, setActiveCategory] = useState<SettingCategory>(initialCategory ?? 'general');
  // Group VIII (Stream C1) + Group VI (Stream C4): the Marketplace nav badge
  // sums templates + plugins update counts into a single pill. v2.0 ships with
  // a single sum for simplicity; if user feedback shows the combined number is
  // confusing we can split into two badges in v2.x.
  const templateUpdateCount = useTemplateUpdateCount();
  const pluginUpdateCount = usePluginUpdateCount();
  const marketplaceUpdateCount = templateUpdateCount + pluginUpdateCount;
  const [searchQuery, setSearchQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Re-apply initialCategory each time the modal opens so callers can
  // deep-link to a specific section. Using a ref to track the previous
  // open state avoids fighting the user's clicks within the same session.
  const prevOpen = useRef(open);
  useEffect(() => {
    if (open && !prevOpen.current && initialCategory) {
      setActiveCategory(initialCategory);
    }
    prevOpen.current = open;
  }, [open, initialCategory]);

  const { getSetting, setSetting, resetAll, exportSettings, importSettings } =
    useSettingsStore();

  // Filter schema entries by search query (spans all categories)
  const filteredSchema = useMemo(() => {
    const lowerQ = searchQuery.toLowerCase().trim();
    if (!lowerQ) return SETTINGS_SCHEMA;
    return SETTINGS_SCHEMA.filter(
      (def) =>
        def.label.toLowerCase().includes(lowerQ) ||
        def.description.toLowerCase().includes(lowerQ) ||
        def.key.toLowerCase().includes(lowerQ)
    );
  }, [searchQuery]);

  // Which categories have visible settings after filtering
  const visibleCategories = useMemo(() => {
    const cats = new Set(filteredSchema.map((d) => d.category));
    // Always include 'shortcuts' if the query matches any shortcut text
    if (searchQuery.trim()) {
      const lowerQ = searchQuery.toLowerCase();
      const anyShortcutMatch = SHORTCUTS.some(
        (s) =>
          s.label.toLowerCase().includes(lowerQ) ||
          (s.description ?? '').toLowerCase().includes(lowerQ) ||
          s.keys.some((k) => k.toLowerCase().includes(lowerQ))
      );
      if (anyShortcutMatch) cats.add('shortcuts');
      // Cost & Usage has no settings rows (dashboard only); include it
      // when the search query matches its label/description keywords.
      const costsMatch = ['cost', 'usage', 'spend', 'budget', 'month'].some(
        (k) => lowerQ.includes(k)
      );
      if (costsMatch) cats.add('costs');
      const templatesMatch = ['template', 'workflow', 'model', 'provider'].some(
        (k) => lowerQ.includes(k)
      );
      if (templatesMatch) cats.add('templates');
      const integrationsMatch = ['mcp', 'claude desktop', 'integration', 'sidecar', 'bundle'].some(
        (k) => lowerQ.includes(k)
      );
      if (integrationsMatch) cats.add('integrations');
      const licenseMatch = ['license', 'activate', 'lifetime', 'pro tier', 'paid'].some(
        (k) => lowerQ.includes(k)
      );
      if (licenseMatch) cats.add('license');
      const privacyMatch = ['privacy', 'telemetry', 'tracking', 'data', 'anonymous', 'opt'].some(
        (k) => lowerQ.includes(k)
      );
      if (privacyMatch) cats.add('privacy');
    } else {
      cats.add('shortcuts');
      cats.add('costs');
      cats.add('templates');
      cats.add('integrations');
      cats.add('marketplace');
      cats.add('plugins');
      cats.add('mobile');
      cats.add('advanced');
      cats.add('license');
      cats.add('privacy');
    }
    return cats;
  }, [filteredSchema, searchQuery]);

  // Settings for the active category
  const categorySettings = useMemo(
    () => filteredSchema.filter((d) => d.category === activeCategory),
    [filteredSchema, activeCategory]
  );

  // Auto-switch to first visible category when search hides the current one
  const effectiveCategory = visibleCategories.has(activeCategory)
    ? activeCategory
    : (SETTING_CATEGORIES.find((c) => visibleCategories.has(c.id))?.id ?? 'general');

  if (effectiveCategory !== activeCategory) {
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    // Schedule for next tick to avoid setState-during-render
    queueMicrotask(() => setActiveCategory(effectiveCategory));
  }

  const handleExport = useCallback(() => {
    const json = exportSettings();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'projelli-settings.json';
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
      // Reset so the same file can be re-imported
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
          {/* Category sidebar */}
          <nav className="w-48 shrink-0 border-r py-2 overflow-y-auto bg-muted/20">
            {SETTING_CATEGORIES.map((cat) => {
              const visible = visibleCategories.has(cat.id);
              if (!visible) return null;
              const isActive = activeCategory === cat.id;
              const showUpdateBadge = cat.id === 'marketplace' && marketplaceUpdateCount > 0;
              return (
                <button
                  key={cat.id}
                  data-testid={`settings-category-${cat.id}`}
                  className={cn(
                    'w-full flex items-center gap-2 text-left px-4 py-2 text-sm transition-colors',
                    isActive
                      ? 'bg-background font-medium text-foreground'
                      : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                  )}
                  onClick={() => setActiveCategory(cat.id)}
                >
                  <span className="flex-1 truncate">{cat.label}</span>
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
            {activeCategory === 'shortcuts' ? (
              <ShortcutsCategory searchQuery={searchQuery} />
            ) : activeCategory === 'costs' ? (
              <CostMetrics entries={auditEntries ?? []} />
            ) : activeCategory === 'templates' ? (
              <TemplateModelSettings templates={templates ?? []} />
            ) : activeCategory === 'license' ? (
              <LicenseSettings />
            ) : activeCategory === 'privacy' ? (
              <PrivacySettings />
            ) : activeCategory === 'integrations' ? (
              <>
                <McpSettingsSection />
                <OllamaSettingsSection />
              </>
            ) : activeCategory === 'marketplace' ? (
              <MarketplaceTab />
            ) : activeCategory === 'plugins' ? (
              <PluginsSettings />
            ) : activeCategory === 'mobile' ? (
              <MobileSettings />
            ) : activeCategory === 'advanced' ? (
              <AdvancedSettings />
            ) : categorySettings.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">
                {t('settings.modal.no-matches')}
              </p>
            ) : (
              <div>
                {activeCategory === 'about' && <AboutHeader />}
                {activeCategory === 'general' && <LanguagePicker />}
                {activeCategory === 'voice' && (
                  <VoiceSettingsSection ttsEnabled={Boolean(getSetting('ttsEnabled'))} />
                )}
                {categorySettings.map((def) => (
                  <SettingRow
                    key={def.key}
                    def={def}
                    value={getSetting(def.key)}
                    onChange={(v) => setSetting(def.key, v)}
                    onAction={handleAction}
                  />
                ))}
                {activeCategory === 'ai' && (
                  <AIContextCapabilityWarning getSetting={getSetting} />
                )}
                {activeCategory === 'memory' && <MemoryFactsSettings />}
              </div>
            )}
          </div>
        </div>

        {/* Footer: action buttons */}
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
          {/* Hidden file input for import */}
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
