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

import { useState, useCallback, useRef, useMemo } from 'react';
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
}

// ---------------------------------------------------------------------------
// Toggle switch (minimal inline implementation since shadcn switch isn't present)
// ---------------------------------------------------------------------------

function Toggle({
  checked,
  onChange,
  id,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  id?: string;
}) {
  return (
    <button
      id={id}
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
    case 'toggle':
      control = (
        <Toggle
          id={controlId}
          checked={Boolean(value)}
          onChange={(v) => onChange(v)}
        />
      );
      break;

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
        No shortcuts match your search.
      </p>
    );
  }

  return (
    <div className="space-y-5">
      {/* Prominent Ctrl+P tip */}
      <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm">
        <span className="font-medium">Quick Tip:</span> Press{' '}
        <kbd className="px-1.5 py-0.5 rounded bg-muted text-xs font-mono">
          {mac ? '⌘' : 'Ctrl'}+P
        </kbd>{' '}
        to quickly open any file by name. Press{' '}
        <kbd className="px-1.5 py-0.5 rounded bg-muted text-xs font-mono">?</kbd>{' '}
        to show the keyboard shortcuts overlay anywhere in the app.
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
// Main modal
// ---------------------------------------------------------------------------

export function SettingsModal({ open, onOpenChange, onAction }: SettingsModalProps) {
  const [activeCategory, setActiveCategory] = useState<SettingCategory>('general');
  const [searchQuery, setSearchQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
    } else {
      cats.add('shortcuts');
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

  const handleAction = useCallback(
    (actionId: string) => {
      onOpenChange(false);
      onAction?.(actionId);
    },
    [onAction, onOpenChange]
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-testid="settings-modal"
        className="max-w-3xl w-[90vw] h-[80vh] max-h-[700px] p-0 flex flex-col overflow-hidden [&>button]:hidden"
      >
        <DialogTitle className="sr-only">Settings</DialogTitle>
        <DialogDescription className="sr-only">
          Configure Projelli preferences
        </DialogDescription>

        {/* Header / Search */}
        <div className="shrink-0 border-b px-4 py-3 flex items-center gap-3">
          <h2 className="text-base font-semibold shrink-0">Settings</h2>
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            <Input
              ref={searchRef}
              data-testid="settings-search"
              placeholder="Search settings..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 pr-8 h-8 text-sm"
            />
            {searchQuery && (
              <button
                type="button"
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                onClick={() => setSearchQuery('')}
                aria-label="Clear search"
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
            aria-label="Close settings"
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
              return (
                <button
                  key={cat.id}
                  data-testid={`settings-category-${cat.id}`}
                  className={cn(
                    'w-full text-left px-4 py-2 text-sm transition-colors',
                    isActive
                      ? 'bg-background font-medium text-foreground'
                      : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                  )}
                  onClick={() => setActiveCategory(cat.id)}
                >
                  {cat.label}
                </button>
              );
            })}
          </nav>

          {/* Content area */}
          <div className="flex-1 overflow-y-auto px-6 py-4">
            {activeCategory === 'shortcuts' ? (
              <ShortcutsCategory searchQuery={searchQuery} />
            ) : categorySettings.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">
                No settings match your search in this category.
              </p>
            ) : (
              <div>
                {categorySettings.map((def) => (
                  <SettingRow
                    key={def.key}
                    def={def}
                    value={getSetting(def.key)}
                    onChange={(v) => setSetting(def.key, v)}
                    onAction={handleAction}
                  />
                ))}
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
            Export
          </Button>
          <Button
            data-testid="settings-import"
            variant="outline"
            size="sm"
            className="gap-1.5 text-xs"
            onClick={handleImport}
          >
            <Upload className="h-3 w-3" />
            Import
          </Button>
          <Button
            data-testid="settings-reset"
            variant="outline"
            size="sm"
            className="gap-1.5 text-xs text-destructive hover:text-destructive"
            onClick={handleReset}
          >
            <RotateCcw className="h-3 w-3" />
            Reset to Defaults
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
  );
}

export default SettingsModal;
