/**
 * AssociateHome — native full-page Workflows surface.
 *
 * Replaces the old "wrap WorkflowPanel" shim with a purpose-built,
 * grouped workflow library. The surface is self-contained: it loads
 * templates via loadAllTemplates(), groups them by category, and renders
 * a scannable grid with collapse/expand, a search bar, practice-area filter
 * chips, and a "recent runs" strip. The only external seams are the five
 * props forwarded from App.tsx (unchanged interface so App.tsx needs no edits).
 *
 * Design:
 *  - Header: eyebrow "WORKFLOWS" + title "Workflows" + search box.
 *  - Practice-area filter chips (horizontal pill row) derived from the actual
 *    categories present after profession scoping. "All" shows everything;
 *    a specific chip narrows the list to that category. Search further narrows
 *    within the selected category (or across all when "All" is active).
 *  - Groups by category in professional order: Legal first (for law ICP),
 *    then Tax / Consulting / Advisors / General / Custom.
 *  - Each group renders as a labeled section with a count badge and a
 *    collapse toggle. Default: top 6 cards visible with a "Show all (N)"
 *    expander so the first screen is calm.
 *  - "Start here" highlight on the primary first task for the legal profession
 *    (Deposition Contradiction Finder) — a subtle accent ring + label.
 *  - Recent Runs strip using runHistory (last 4), each row clickable
 *    (onFocusExecutionTab) and showing status + relative time.
 *  - providerError banner with onOpenSettings action.
 *  - trial-locked state: Run buttons disabled with tooltip.
 *
 * Prop interface is IDENTICAL to the original so App.tsx is untouched.
 */

import { useMemo, useState, useEffect } from 'react';
import {
  Play,
  CheckCircle2,
  XCircle,
  Clock,
  ChevronDown,
  ChevronRight,
  Search,
  Loader2,
  Star,
  Settings,
  Briefcase,
  ListChecks,
  AlertTriangle,
  AlertCircle,
} from 'lucide-react';
import { SurfaceHeader } from '@/ui/SurfaceHeader';
import { Button, Chip, Eyebrow, Card, EmptyState, Callout, SearchField, SurfaceToolbar } from '@/ui/kp';
import type { WorkflowTemplate, WorkflowExecution, RunRecord, WorkflowChain } from '@/platform/types/workflow';
import { loadAllTemplates } from '@/features/workflows/engine/userTemplates';
import { prioritizeByProfession } from '@/features/workflows/engine/prioritizeByProfession';
import type { Profession } from '@/features/workflows/engine/prioritizeByProfession';
import { useProfessionStore, isLawExperience } from '@/platform/profile/professionStore';
import { useTrialGate } from '@/platform/hooks/useTrial';
import { useActiveMatter } from '@/platform/matter/matterStore';
import { useConfidentialityMode } from '@/platform/hooks/useConfidentialityMode';
import { useActiveEgressProvider } from '@/platform/hooks/useActiveEgressProvider';
import { EgressIndicator } from '@/platform/privacy/ui/EgressIndicator';
import { matterLabel } from '@/platform/rag/matterResolver';
import { SK_WORKFLOWS_FILTER, SK_WORKFLOWS_COLLAPSED } from '@/config/identity';

// ── Prop interface (kept identical to original) ────────────────────────────

interface AssociateHomeProps {
  onStartWorkflow: (template: WorkflowTemplate) => void;
  currentExecution: WorkflowExecution | null;
  runHistory: RunRecord[];
  providerError?: 'needs-provider' | 'ollama-unreachable' | null;
  onOpenSettings?: () => void;
  onFocusExecutionTab?: () => void;
  onRunChain?: (chain: WorkflowChain) => void;
}

// ── Category grouping config ───────────────────────────────────────────────

type TemplateCategory = WorkflowTemplate['category'];
type FilterKey = TemplateCategory | 'all';

interface CategoryConfig {
  key: TemplateCategory;
  label: string;
  description: string;
}

const CATEGORY_ORDER: CategoryConfig[] = [
  { key: 'legal', label: 'Legal Practice', description: 'Litigation, discovery, client intake, and transactional work' },
  { key: 'tax', label: 'Tax', description: 'Tax research, planning, and compliance workflows' },
  { key: 'consulting', label: 'Consulting', description: 'Client engagements, strategy, and deliverables' },
  { key: 'advisors', label: 'Advisors', description: 'Advisory practice workflows and client management' },
  { key: 'research', label: 'Research', description: 'General research and analysis' },
  { key: 'analysis', label: 'Analysis', description: 'Document and data analysis' },
  { key: 'planning', label: 'Planning', description: 'Business and project planning' },
  { key: 'kickoff', label: 'Kickoff', description: 'New project and client onboarding' },
  { key: 'custom', label: 'Custom', description: 'Your own saved templates' },
];

/**
 * Maps each onboarding profession key to the template category that should
 * render FIRST in the "All" view.  Mirrors the category→profession mapping
 * used in prioritizeByProfession.ts (note: advisor = singular key, advisors =
 * plural category key on templates).
 * 'other' is omitted intentionally — no profession preference, natural order.
 */
const PROFESSION_PRIMARY_CATEGORY: Partial<Record<Profession, TemplateCategory>> = {
  legal: 'legal',
  tax: 'tax',
  consulting: 'consulting',
  advisor: 'advisors',
};

/** The primary "start here" template id for the legal profession. */
const LAW_FEATURED_ID = 'deposition-contradiction-finder';

// ── localStorage persistence ───────────────────────────────────────────────

const LS_FILTER_KEY = SK_WORKFLOWS_FILTER;
const LS_COLLAPSED_KEY = SK_WORKFLOWS_COLLAPSED;

function readStoredFilter(): FilterKey {
  try {
    const raw = localStorage.getItem(LS_FILTER_KEY);
    if (!raw) return 'all';
    // Validate that the stored value is a known key before trusting it.
    const valid: string[] = ['all', ...CATEGORY_ORDER.map((c) => c.key)];
    return valid.includes(raw) ? (raw as FilterKey) : 'all';
  } catch {
    return 'all';
  }
}

function writeStoredFilter(key: FilterKey): void {
  try {
    localStorage.setItem(LS_FILTER_KEY, key);
  } catch {
    // ignore
  }
}

function readStoredCollapsed(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(LS_COLLAPSED_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, boolean>;
    }
    return {};
  } catch {
    return {};
  }
}

function writeStoredCollapsed(state: Record<string, boolean>): void {
  try {
    localStorage.setItem(LS_COLLAPSED_KEY, JSON.stringify(state));
  } catch {
    // ignore
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────

function formatRelativeTime(isoString: string): string {
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${String(diffMins)}m ago`;
  if (diffMins < 1440) return `${String(Math.floor(diffMins / 60))}h ago`;
  return `${String(Math.floor(diffMins / 1440))}d ago`;
}

// ── Sub-components ─────────────────────────────────────────────────────────

/** Practice-area filter chip. */
function PracticeFilterChip({
  label,
  active,
  testId,
  onClick,
}: {
  label: string;
  active: boolean;
  testId?: string;
  onClick: () => void;
}) {
  return (
    <Chip
      active={active}
      size="md"
      data-testid={testId}
      onClick={onClick}
    >
      {label}
    </Chip>
  );
}

/** Template card: name, description, "featured" highlight, Run button. */
function TemplateCard({
  template,
  isFeatured,
  isRunning,
  trialLocked,
  executionActive,
  onRun,
}: {
  template: WorkflowTemplate;
  isFeatured: boolean;
  isRunning: boolean;
  trialLocked: boolean;
  executionActive: boolean;
  onRun: (t: WorkflowTemplate) => void;
}) {
  const disabled = trialLocked || (executionActive && !isRunning);

  return (
    <Card
      variant="raised"
      featured={isFeatured}
      data-testid={`associate-card-${template.id}`}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--kp-space-sm)',
        position: 'relative',
      }}
    >
      {/* Featured badge — drooping tab below card top edge */}
      {isFeatured && (
        <div
          style={{
            position: 'absolute',
            top: -1,
            right: 12,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            padding: '2px 8px',
            background: 'var(--kp-action-bg)',
            color: 'var(--kp-action-fg)',
            fontSize: 'var(--kp-font-2xs)',
            fontWeight: 'var(--kp-weight-bold)',
            letterSpacing: '0.07em',
            textTransform: 'uppercase',
            borderRadius: '0 0 4px 4px',
          }}
        >
          <Star style={{ width: 'var(--kp-icon-xs)', height: 'var(--kp-icon-xs)', fill: '#fff', strokeWidth: 0 }} />
          Start here
        </div>
      )}

      {/* Card body */}
      <div style={{ flex: 1 }}>
        <div
          style={{
            fontSize: 'var(--kp-font-sm)',
            fontWeight: 'var(--kp-weight-bold)',
            color: 'var(--kp-navy)',
            lineHeight: 'var(--kp-leading-snug)',
            marginBottom: 'var(--kp-space-2xs)',
            paddingRight: isFeatured ? 80 : 0,
          }}
        >
          {template.name}
        </div>
        <div
          style={{
            fontSize: 'var(--kp-font-xs)',
            color: 'var(--color-muted-foreground)',
            lineHeight: 'var(--kp-leading-relaxed)',
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}
        >
          {template.description}
        </div>
      </div>

      {/* Run button */}
      <Button
        variant={isFeatured ? 'primary' : 'secondary'}
        size="sm"
        iconLeft={isRunning ? Loader2 : Play}
        data-testid={`associate-run-${template.id}`}
        disabled={disabled}
        onClick={() => { if (!disabled) onRun(template); }}
        title={trialLocked ? 'Trial ended - activate a license to run workflows' : `Run ${template.name}`}
        style={{ alignSelf: 'flex-start' }}
      >
        {isRunning ? 'Running' : 'Run'}
      </Button>
    </Card>
  );
}

/** Collapsible category section with top-N expander. */
function CategorySection({
  config,
  templates,
  totalCount,
  searchActive,
  featuredId,
  initialCount = 6,
  currentExecution,
  trialLocked,
  collapsed,
  onCollapse,
  onRun,
}: {
  config: CategoryConfig;
  templates: WorkflowTemplate[];
  /** Pre-search total for this category. Used to show "N of M" when a search has narrowed the list. */
  totalCount: number;
  /** Whether the user has an active search query (used to decide whether to show "hidden by search" hint). */
  searchActive: boolean;
  featuredId: string | null;
  initialCount?: number;
  currentExecution: WorkflowExecution | null;
  trialLocked: boolean;
  collapsed: boolean;
  onCollapse: (key: string, collapsed: boolean) => void;
  onRun: (t: WorkflowTemplate) => void;
}) {
  const [showAll, setShowAll] = useState(false);

  const visible = collapsed
    ? []
    : showAll
    ? templates
    : templates.slice(0, initialCount);

  const hiddenCount = templates.length - initialCount;
  // When a search is active and has narrowed this category, compute how many are hidden by search.
  const hiddenBySearch = searchActive ? totalCount - templates.length : 0;

  return (
    <section
      data-testid={`associate-section-${config.key}`}
      style={{ marginBottom: 'var(--kp-section-gap)' }}
    >
      {/* Section header */}
      <button
        type="button"
        data-testid={`associate-section-toggle-${config.key}`}
        onClick={() => { onCollapse(config.key, !collapsed); }}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          padding: '0 0 var(--kp-space-sm)',
          width: '100%',
          textAlign: 'left',
        }}
        aria-expanded={!collapsed}
      >
        {collapsed ? (
          <ChevronRight style={{ width: 'var(--kp-icon-sm)', height: 'var(--kp-icon-sm)', color: 'var(--color-muted-foreground)', flex: 'none' }} />
        ) : (
          <ChevronDown style={{ width: 'var(--kp-icon-sm)', height: 'var(--kp-icon-sm)', color: 'var(--color-muted-foreground)', flex: 'none' }} />
        )}
        <Eyebrow primary>{config.label}</Eyebrow>
        <span
          data-testid={`associate-section-count-${config.key}`}
          style={{
            fontSize: 'var(--kp-font-2xs)',
            color: 'var(--color-muted-foreground)',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {hiddenBySearch > 0
            ? `(${String(templates.length)} of ${String(totalCount)})`
            : `(${String(templates.length)})`}
        </span>
      </button>

      {/* Cards grid */}
      {!collapsed && (
        <>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
              gap: 'var(--kp-space-md)',
            }}
          >
            {visible.map((t) => (
              <TemplateCard
                key={t.id}
                template={t}
                isFeatured={t.id === featuredId}
                isRunning={currentExecution?.template.id === t.id}
                trialLocked={trialLocked}
                executionActive={currentExecution !== null}
                onRun={onRun}
              />
            ))}
          </div>

          {/* Expander */}
          {!showAll && hiddenCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              iconLeft={ChevronDown}
              data-testid={`associate-show-all-${config.key}`}
              onClick={() => { setShowAll(true); }}
              style={{ marginTop: 'var(--kp-space-sm)' }}
            >
              Show all ({String(templates.length)})
            </Button>
          )}

          {/* Search-hidden hint — shown when search has narrowed this category */}
          {hiddenBySearch > 0 && (
            <div
              data-testid={`associate-search-hidden-${config.key}`}
              style={{
                marginTop: 'var(--kp-space-sm)',
                fontSize: 'var(--kp-font-2xs)',
                color: 'var(--color-muted-foreground)',
                lineHeight: 'var(--kp-leading-normal)',
              }}
            >
              {/* eslint-disable keepance-i18n/no-hardcoded-string */}
              {String(hiddenBySearch)} more hidden by search.{' '}
              <button
                type="button"
                data-testid={`associate-search-hidden-clear-${config.key}`}
                onClick={() => { onCollapse('__clear-search__', false); }}
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  padding: 0,
                  fontSize: 'var(--kp-font-2xs)',
                  fontWeight: 'var(--kp-weight-semibold)',
                  color: 'var(--kp-navy)',
                  textDecoration: 'underline',
                }}
              >
                Clear search
              </button>
              {/* eslint-enable keepance-i18n/no-hardcoded-string */}
            </div>
          )}
        </>
      )}
    </section>
  );
}

/** Single recent-run row. */
function RunRow({
  run,
  onFocus,
}: {
  run: RunRecord;
  onFocus?: () => void;
}) {
  const statusIcon =
    run.status === 'completed' ? (
      <CheckCircle2 style={{ width: 'var(--kp-icon-sm)', height: 'var(--kp-icon-sm)', color: '#22c55e', flex: 'none' }} />
    ) : run.status === 'failed' ? (
      <XCircle style={{ width: 'var(--kp-icon-sm)', height: 'var(--kp-icon-sm)', color: '#ef4444', flex: 'none' }} />
    ) : (
      <Clock style={{ width: 'var(--kp-icon-sm)', height: 'var(--kp-icon-sm)', color: 'var(--color-muted-foreground)', flex: 'none' }} />
    );

  return (
    <button
      type="button"
      data-testid={`associate-run-row-${run.run_id}`}
      onClick={onFocus}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '8px 0',
        background: 'none',
        border: 'none',
        borderBottom: '1px solid var(--kp-divider)',
        width: '100%',
        textAlign: 'left',
        cursor: onFocus ? 'pointer' : 'default',
      }}
    >
      {statusIcon}
      <span
        style={{
          flex: 1,
          fontSize: 'var(--kp-font-sm)',
          color: 'var(--kp-navy)',
          fontWeight: 'var(--kp-weight-medium)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {run.workflow}
      </span>
      <span
        style={{
          fontSize: 'var(--kp-font-2xs)',
          color: 'var(--color-muted-foreground)',
          fontVariantNumeric: 'tabular-nums',
          flex: 'none',
        }}
      >
        {formatRelativeTime(run.start_time)}
      </span>
    </button>
  );
}

// ── Main export ────────────────────────────────────────────────────────────

export function AssociateHome({
  onStartWorkflow,
  currentExecution,
  runHistory,
  providerError,
  onOpenSettings,
  onFocusExecutionTab,
}: AssociateHomeProps) {
  const trialGate = useTrialGate();
  const profession = useProfessionStore((s) => s.profession);
  const activeMatter = useActiveMatter();
  // Workflows run AI — show the same egress badge as Ask, top-right.
  const confidentialityMode = useConfidentialityMode();
  const egressProvider = useActiveEgressProvider(confidentialityMode);
  // Run-time household clarity: clicking Run asks for confirmation, making it
  // explicit which household the workflow will run in (replaces the old pill).
  const [pendingRun, setPendingRun] = useState<WorkflowTemplate | null>(null);
  const [query, setQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState<FilterKey>(readStoredFilter);
  const [collapsedCategories, setCollapsedCategories] = useState<Record<string, boolean>>(readStoredCollapsed);

  // Persist filter to localStorage whenever it changes.
  useEffect(() => {
    writeStoredFilter(activeFilter);
  }, [activeFilter]);

  // Persist collapsed state to localStorage whenever it changes.
  useEffect(() => {
    writeStoredCollapsed(collapsedCategories);
  }, [collapsedCategories]);

  // Load + scope templates exactly as WorkflowPanel does.
  const templates = useMemo(() => {
    const all = loadAllTemplates();
    const scoped = isLawExperience(profession)
      ? all.filter((t) => t.category === 'legal' || t.category === 'custom')
      : all;
    return prioritizeByProfession(scoped, profession);
  }, [profession]);

  // Derive the ordered set of categories that are actually present.
  // The active profession's category is floated to the top so the filter chips
  // mirror the same ordering as the section list below.
  const presentCategories = useMemo((): CategoryConfig[] => {
    const present = new Set(templates.map((t) => t.category));
    const ordered = CATEGORY_ORDER.filter((cfg) => present.has(cfg.key));
    const primaryCategory = PROFESSION_PRIMARY_CATEGORY[profession as Profession];
    if (primaryCategory) {
      const idx = ordered.findIndex((cfg) => cfg.key === primaryCategory);
      const primary = ordered[idx];
      if (idx > 0 && primary !== undefined) {
        ordered.splice(idx, 1);
        ordered.unshift(primary);
      }
    }
    return ordered;
  }, [templates, profession]);

  // Apply practice-area filter chip first to get the pre-search scope.
  const categoryFiltered = useMemo(() => {
    return activeFilter === 'all'
      ? templates
      : templates.filter((t) => t.category === activeFilter);
  }, [templates, activeFilter]);

  // Pre-search totals per category (used by CategorySection to show "N of M").
  const preSearchTotals = useMemo(() => {
    const totals = new Map<TemplateCategory, number>();
    for (const t of categoryFiltered) {
      totals.set(t.category, (totals.get(t.category) ?? 0) + 1);
    }
    return totals;
  }, [categoryFiltered]);

  const searchActive = query.trim().length > 0;

  // Apply search query within the category-filtered scope.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return categoryFiltered;
    return categoryFiltered.filter((t) => {
      const hay = `${t.name} ${t.description} ${t.category}`.toLowerCase();
      return hay.includes(q);
    });
  }, [categoryFiltered, query]);

  // Group filtered templates by category in the defined order, including pre-search totals.
  // The active profession's category is floated to the top so the advisor (or tax, etc.)
  // user always sees their own pack first in the "All" view.
  const groups = useMemo(() => {
    const byCategory = new Map<TemplateCategory, WorkflowTemplate[]>();
    for (const t of filtered) {
      const bucket = byCategory.get(t.category) ?? [];
      bucket.push(t);
      byCategory.set(t.category, bucket);
    }
    // Include categories that have templates pre-search even if they're now empty post-search,
    // so the hidden-by-search hint can appear. However, if a category has 0 filtered results,
    // we still only show it when searching so we can display the hint.
    const configsToShow = CATEGORY_ORDER.filter((cfg) => {
      const filtered_count = (byCategory.get(cfg.key) ?? []).length;
      const total = preSearchTotals.get(cfg.key) ?? 0;
      // Show if has filtered results, OR has pre-search templates and search is active (for hint).
      return filtered_count > 0 || (searchActive && total > 0);
    });
    // Float the active profession's category to the front so the user's own pack leads.
    const primaryCategory = PROFESSION_PRIMARY_CATEGORY[profession as Profession];
    if (primaryCategory) {
      const idx = configsToShow.findIndex((cfg) => cfg.key === primaryCategory);
      const primary = configsToShow[idx];
      if (idx > 0 && primary !== undefined) {
        configsToShow.splice(idx, 1);
        configsToShow.unshift(primary);
      }
    }
    return configsToShow.map((cfg) => ({
      config: cfg,
      templates: byCategory.get(cfg.key) ?? [],
      totalCount: preSearchTotals.get(cfg.key) ?? 0,
    }));
  }, [filtered, preSearchTotals, searchActive, profession]);

  // Featured template: first task in the legal profession (starts-here hint).
  const featuredId = isLawExperience(profession) ? LAW_FEATURED_ID : null;

  const recentRuns = runHistory.slice(0, 4);

  // When the filter chip changes, reset search so the state is consistent.
  function handleFilterChange(key: FilterKey) {
    setActiveFilter(key);
    setQuery('');
  }

  // When search is cleared (e.g. from empty-state button), also reset filter.
  function handleClearAll() {
    setQuery('');
    setActiveFilter('all');
  }

  // Collapse callback forwarded to CategorySection.
  // The sentinel key '__clear-search__' means: clear the search query (triggered
  // by the "Clear search" link inside the search-hidden hint).
  function handleCollapse(key: string, isCollapsed: boolean) {
    if (key === '__clear-search__') {
      setQuery('');
      return;
    }
    setCollapsedCategories((prev) => {
      const next = { ...prev, [key]: isCollapsed };
      return next;
    });
  }

  return (
    <div
      data-testid="associate-home"
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        flex: 1,
        minWidth: 0,
        background: 'var(--color-background)',
        fontFamily: 'Satoshi, sans-serif',
        overflowY: 'auto',
      }}
    >
      {/* ── Page header ─────────────────────────────────────────────── */}
      <div style={{ padding: 'var(--kp-surface-header-pad)', borderBottom: '1px solid var(--kp-divider)', flexShrink: 0 }}>
        <SurfaceHeader
          Icon={ListChecks}
          iconColor="var(--kp-accent)"
          title="Workflows"
          actions={
            <EgressIndicator provider={egressProvider} mode={confidentialityMode} variant="status" />
          }
        />
      </div>

      {/* ── Toolbar: filters (practice chips) then search last ──── */}
      <SurfaceToolbar data-testid="associate-toolbar" style={{ borderBottom: 'none' }}>
        {presentCategories.length > 1 && (
          <div
            data-testid="associate-practice-filter"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              flexWrap: 'wrap',
            }}
          >
            <PracticeFilterChip
              label="All"
              active={activeFilter === 'all'}
              testId="associate-filter-all"
              onClick={() => { handleFilterChange('all'); }}
            />
            {presentCategories.map((cfg) => (
              <PracticeFilterChip
                key={cfg.key}
                label={cfg.label}
                active={activeFilter === cfg.key}
                testId={`associate-filter-${cfg.key}`}
                onClick={() => { handleFilterChange(cfg.key); }}
              />
            ))}
          </div>
        )}
        <SearchField
          data-testid="associate-search"
          value={query}
          onChange={(v) => { setQuery(v); }}
          onClear={() => { setQuery(''); }}
          placeholder="Search workflows..."
          size="md"
          style={{ flex: 1, minWidth: 240 }}
        />
      </SurfaceToolbar>

      {/* ── Banners ──────────────────────────────────────────────────── */}

      {/* Trial-expired banner */}
      {trialGate.isLocked && (
        <div
          data-testid="associate-trial-banner"
          style={{ margin: 'var(--kp-space-sm) var(--kp-gutter) 0' }}
        >
          <Callout variant="warning" icon={AlertTriangle}>
            {/* eslint-disable keepance-i18n/no-hardcoded-string */}
            <strong>Trial ended.</strong> Activate a license to run workflows. Your work is still here and fully accessible.
            {/* eslint-enable keepance-i18n/no-hardcoded-string */}
          </Callout>
        </div>
      )}

      {/* Provider-error banner */}
      {providerError && (
        <div
          data-testid="associate-provider-error"
          role="alert"
          style={{ margin: 'var(--kp-space-sm) var(--kp-gutter) 0' }}
        >
          <Callout variant="error" icon={AlertCircle}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <span style={{ flex: 1 }}>
                {providerError === 'ollama-unreachable' ? (
                  <span>
                    {/* eslint-disable keepance-i18n/no-hardcoded-string */}
                    <strong>Local AI unreachable.</strong>
                    {' Keepance Local AI is not responding. Make sure it has finished setting up, then try again.'}
                    {/* eslint-enable keepance-i18n/no-hardcoded-string */}
                  </span>
                ) : (
                  <span>
                    {/* eslint-disable keepance-i18n/no-hardcoded-string */}
                    <strong>No AI provider configured.</strong>
                    {' Add an API key or set up Keepance Local AI to run workflows.'}
                    {/* eslint-enable keepance-i18n/no-hardcoded-string */}
                  </span>
                )}
              </span>
              {onOpenSettings && providerError === 'needs-provider' && (
                <Button
                  variant="primary"
                  size="sm"
                  iconLeft={Settings}
                  onClick={onOpenSettings}
                >
                  Open settings
                </Button>
              )}
            </div>
          </Callout>
        </div>
      )}

      {/* ── Body ─────────────────────────────────────────────────────── */}
      <div
        style={{
          flex: 1,
          padding: 'var(--kp-surface-gap) var(--kp-gutter)',
          display: 'flex',
          flexDirection: 'column',
          gap: 0,
        }}
      >
        {/* Recent runs strip */}
        {recentRuns.length > 0 && (
          <div style={{ marginBottom: 'var(--kp-section-gap)' }}>
            <div style={{ marginBottom: 6 }}>
              <Eyebrow primary>Recent runs</Eyebrow>
            </div>
            <Card
              variant="flat"
              data-testid="associate-recent-runs"
              style={{ overflow: 'hidden' }}
            >
              {recentRuns.map((run) => (
                <RunRow
                  key={run.run_id}
                  run={run}
                  {...(onFocusExecutionTab !== undefined && { onFocus: onFocusExecutionTab })}
                />
              ))}
            </Card>
          </div>
        )}

        {/* The household is surfaced at RUN TIME (the run-confirmation modal),
            not as a persistent "Running in" pill here. */}

        {/* Template groups */}
        {groups.every((g) => g.templates.length === 0) ? (
          // eslint-disable keepance-i18n/no-hardcoded-string
          <EmptyState
            data-testid="associate-empty"
            icon={Search}
            title="No workflows match"
            body="Try a different search term, or clear the filter to see all workflows."
            actions={
              <Button variant="secondary" size="sm" onClick={handleClearAll}>
                Clear search
              </Button>
            }
          />
          // eslint-enable keepance-i18n/no-hardcoded-string
        ) : (
          groups.map(({ config, templates: groupTemplates, totalCount }) => (
            <CategorySection
              key={config.key}
              config={config}
              templates={groupTemplates}
              totalCount={totalCount}
              searchActive={searchActive}
              featuredId={featuredId}
              {...(profession === 'advisor' && config.key === 'advisors' ? { initialCount: 3 } : {})}
              currentExecution={currentExecution}
              trialLocked={trialGate.isLocked}
              collapsed={collapsedCategories[config.key] === true}
              onCollapse={handleCollapse}
              onRun={(t) => { setPendingRun(t); }}
            />
          ))
        )}
      </div>

      {/* Run-time household confirmation — makes the target household explicit
          at the moment of running (replaces the persistent "Running in" pill). */}
      {pendingRun && (
        <div
          data-testid="workflow-run-confirm"
          role="dialog"
          aria-modal="true"
          onClick={() => { setPendingRun(null); }}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 1000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(10, 37, 64, 0.34)',
            backdropFilter: 'blur(2px)',
          }}
        >
          <div
            onClick={(e) => { e.stopPropagation(); }}
            style={{
              width: 460,
              maxWidth: 'calc(100vw - 64px)',
              background: 'var(--color-background)',
              border: '1px solid var(--kp-divider)',
              borderRadius: 14,
              boxShadow: '0 12px 48px rgba(10,37,64,0.20), 0 2px 8px rgba(10,37,64,0.10)',
              padding: '24px 24px 20px',
              fontFamily: 'Satoshi, sans-serif',
            }}
          >
            <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--kp-accent)', marginBottom: 10 }}>
              Run workflow
            </div>
            <h2 style={{ margin: '0 0 14px', fontSize: 20, fontWeight: 700, color: 'var(--kp-navy)', letterSpacing: '-0.01em' }}>
              {pendingRun.name}
            </h2>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '12px 14px',
                borderRadius: 10,
                background: 'var(--kp-bg-soft)',
                border: '1px solid var(--kp-divider)',
                marginBottom: 20,
              }}
            >
              <Briefcase size={16} strokeWidth={2} style={{ color: 'var(--kp-accent)', flex: 'none' }} />
              <span style={{ fontSize: 14, color: 'var(--kp-text-dim)' }}>Run in</span>
              <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--kp-navy)' }}>
                {activeMatter !== null ? matterLabel(activeMatter) : 'your workspace'}
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <Button variant="secondary" size="md" onClick={() => { setPendingRun(null); }}>
                Cancel
              </Button>
              <Button
                variant="primary"
                size="md"
                data-testid="workflow-run-confirm-go"
                onClick={() => { const t = pendingRun; setPendingRun(null); onStartWorkflow(t); }}
              >
                Run
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
