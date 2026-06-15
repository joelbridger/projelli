/**
 * ReimaginedAssociateHome — native full-page Workflows surface.
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
} from 'lucide-react';
import { SurfaceHeader } from '@/components/layout/SurfaceHeader';
import type { WorkflowTemplate, WorkflowExecution, RunRecord, WorkflowChain } from '@/types/workflow';
import { loadAllTemplates } from '@/modules/workflow/userTemplates';
import { prioritizeByProfession } from '@/modules/workflow/prioritizeByProfession';
import { useProfessionStore, isLawExperience } from '@/stores/professionStore';
import { useTrialGate } from '@/hooks/useTrial';
import { useActiveMatter } from '@/stores/matterStore';
import { matterLabel } from '@/modules/memory/matterResolver';

// ── Prop interface (kept identical to original) ────────────────────────────

interface ReimaginedAssociateHomeProps {
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

/** The primary "start here" template id for the legal profession. */
const LAW_FEATURED_ID = 'deposition-contradiction-finder';

// ── localStorage persistence ───────────────────────────────────────────────

const LS_FILTER_KEY = 'keepance:workflows-filter';
const LS_COLLAPSED_KEY = 'keepance:workflows-collapsed';

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
    <button
      type="button"
      data-testid={testId}
      onClick={onClick}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding: '4px 12px',
        borderRadius: 20,
        fontSize: 12,
        fontWeight: active ? 700 : 500,
        cursor: 'pointer',
        border: active ? '1.5px solid var(--kp-navy)' : '1px solid var(--color-border)',
        background: active ? 'var(--kp-navy)' : '#fff',
        color: active ? '#fff' : 'var(--color-muted-foreground)',
        transition: 'background 0.1s, color 0.1s, border-color 0.1s',
        whiteSpace: 'nowrap',
        letterSpacing: '0.01em',
        lineHeight: 1,
        flexShrink: 0,
      }}
    >
      {label}
    </button>
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
    <div
      data-testid={`associate-card-${template.id}`}
      style={{
        border: isFeatured
          ? '2px solid var(--kp-navy)'
          : '1px solid var(--color-border)',
        borderRadius: 8,
        padding: 'var(--kp-card-pad)',
        background: isFeatured ? 'rgba(10,37,64,0.03)' : '#fff',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--kp-space-sm)',
        position: 'relative',
        transition: 'box-shadow 0.12s',
      }}
    >
      {/* Featured badge */}
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
            background: 'var(--kp-navy)',
            color: '#fff',
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: '0.07em',
            textTransform: 'uppercase',
            borderRadius: '0 0 4px 4px',
          }}
        >
          <Star style={{ width: 9, height: 9, fill: '#fff', strokeWidth: 0 }} />
          Start here
        </div>
      )}

      {/* Card body */}
      <div style={{ flex: 1 }}>
        <div
          style={{
            fontSize: 13,
            fontWeight: 700,
            color: 'var(--kp-navy)',
            lineHeight: 1.35,
            marginBottom: 'var(--kp-space-2xs)',
            paddingRight: isFeatured ? 80 : 0,
          }}
        >
          {template.name}
        </div>
        <div
          style={{
            fontSize: 12,
            color: 'var(--color-muted-foreground)',
            lineHeight: 1.5,
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
      <button
        type="button"
        data-testid={`associate-run-${template.id}`}
        disabled={disabled}
        onClick={() => { if (!disabled) onRun(template); }}
        title={trialLocked ? 'Trial ended — activate a license to run workflows' : `Run ${template.name}`}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 6,
          padding: '6px 14px',
          borderRadius: 5,
          fontSize: 12,
          fontWeight: 600,
          background: disabled
            ? 'var(--color-muted)'
            : isFeatured
            ? 'var(--kp-navy)'
            : 'transparent',
          color: disabled
            ? 'var(--color-muted-foreground)'
            : isFeatured
            ? '#fff'
            : 'var(--kp-navy)',
          border: `1px solid ${disabled ? 'var(--color-border)' : 'var(--kp-navy)'}`,
          cursor: disabled ? 'not-allowed' : 'pointer',
          alignSelf: 'flex-start',
          transition: 'opacity 0.1s',
        }}
      >
        {isRunning ? (
          <Loader2 style={{ width: 12, height: 12, strokeWidth: 2 }} className="animate-spin" />
        ) : (
          <Play style={{ width: 12, height: 12, strokeWidth: 2, fill: disabled ? 'none' : (isFeatured ? '#fff' : 'var(--kp-navy)') }} />
        )}
        {isRunning ? 'Running' : 'Run'}
      </button>
    </div>
  );
}

/** Collapsible category section with top-N expander. */
function CategorySection({
  config,
  templates,
  totalCount,
  searchActive,
  featuredId,
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
  currentExecution: WorkflowExecution | null;
  trialLocked: boolean;
  collapsed: boolean;
  onCollapse: (key: string, collapsed: boolean) => void;
  onRun: (t: WorkflowTemplate) => void;
}) {
  const INITIAL_COUNT = 6;
  const [showAll, setShowAll] = useState(false);

  const visible = collapsed
    ? []
    : showAll
    ? templates
    : templates.slice(0, INITIAL_COUNT);

  const hiddenCount = templates.length - INITIAL_COUNT;
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
          <ChevronRight style={{ width: 14, height: 14, color: 'var(--color-muted-foreground)', flex: 'none' }} />
        ) : (
          <ChevronDown style={{ width: 14, height: 14, color: 'var(--color-muted-foreground)', flex: 'none' }} />
        )}
        <span
          style={{
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            color: 'var(--kp-navy)',
          }}
        >
          {config.label}
        </span>
        <span
          data-testid={`associate-section-count-${config.key}`}
          style={{
            fontSize: 11,
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
            <button
              type="button"
              data-testid={`associate-show-all-${config.key}`}
              onClick={() => { setShowAll(true); }}
              style={{
                marginTop: 'var(--kp-space-sm)',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                fontSize: 12,
                fontWeight: 600,
                color: 'var(--kp-navy)',
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                padding: '4px 0',
                letterSpacing: '0.01em',
              }}
            >
              <ChevronDown style={{ width: 13, height: 13, strokeWidth: 2 }} />
              Show all ({String(templates.length)})
            </button>
          )}

          {/* Search-hidden hint — shown when search has narrowed this category */}
          {hiddenBySearch > 0 && (
            <div
              data-testid={`associate-search-hidden-${config.key}`}
              style={{
                marginTop: 'var(--kp-space-sm)',
                fontSize: 11,
                color: 'var(--color-muted-foreground)',
                lineHeight: 1.4,
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
                  fontSize: 11,
                  fontWeight: 600,
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
      <CheckCircle2 style={{ width: 13, height: 13, color: '#22c55e', flex: 'none' }} />
    ) : run.status === 'failed' ? (
      <XCircle style={{ width: 13, height: 13, color: '#ef4444', flex: 'none' }} />
    ) : (
      <Clock style={{ width: 13, height: 13, color: 'var(--color-muted-foreground)', flex: 'none' }} />
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
        borderBottom: '1px solid var(--color-border)',
        width: '100%',
        textAlign: 'left',
        cursor: onFocus ? 'pointer' : 'default',
      }}
    >
      {statusIcon}
      <span
        style={{
          flex: 1,
          fontSize: 13,
          color: 'var(--kp-navy)',
          fontWeight: 500,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {run.workflow}
      </span>
      <span
        style={{
          fontSize: 11,
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

export function ReimaginedAssociateHome({
  onStartWorkflow,
  currentExecution,
  runHistory,
  providerError,
  onOpenSettings,
  onFocusExecutionTab,
}: ReimaginedAssociateHomeProps) {
  const trialGate = useTrialGate();
  const profession = useProfessionStore((s) => s.profession);
  const activeMatter = useActiveMatter();
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
  const presentCategories = useMemo((): CategoryConfig[] => {
    const present = new Set(templates.map((t) => t.category));
    return CATEGORY_ORDER.filter((cfg) => present.has(cfg.key));
  }, [templates]);

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
    return configsToShow.map((cfg) => ({
      config: cfg,
      templates: byCategory.get(cfg.key) ?? [],
      totalCount: preSearchTotals.get(cfg.key) ?? 0,
    }));
  }, [filtered, preSearchTotals, searchActive]);

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
        background: 'var(--color-background)',
        fontFamily: 'Satoshi, sans-serif',
        overflowY: 'auto',
      }}
    >
      {/* ── Page header ─────────────────────────────────────────────── */}
      <div
        style={{
          padding: 'var(--kp-surface-header-pad)',
          borderBottom: '1px solid var(--color-border)',
          flexShrink: 0,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
            <div>
              <SurfaceHeader
                Icon={ListChecks}
                title="Workflows"
                description={`Your tireless associate. ${String(templates.length)} workflow${templates.length === 1 ? '' : 's'} ready — pick one to run.`}
              />

              {/* Active-matter context chip — shown below the header */}
              {activeMatter !== null && (
                <div
                  data-testid="associate-active-matter-chip"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 5,
                    marginTop: 8,
                    padding: '3px 10px',
                    borderRadius: 20,
                    border: '1px solid rgba(10,37,64,0.18)',
                    background: 'rgba(10,37,64,0.05)',
                    fontSize: 11,
                    fontWeight: 600,
                    letterSpacing: '0.02em',
                    color: 'var(--kp-navy)',
                    maxWidth: 360,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  <Briefcase style={{ width: 10, height: 10, strokeWidth: 2, flex: 'none' }} />
                  Running in: {matterLabel(activeMatter)}
                </div>
              )}
            </div>
          </div>

          {/* Search box */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              border: '1px solid var(--color-border)',
              borderRadius: 6,
              padding: '7px 12px',
              background: '#fff',
              minWidth: 220,
              flex: '0 1 280px',
            }}
          >
            <Search style={{ width: 14, height: 14, color: 'var(--color-muted-foreground)', flex: 'none' }} />
            <input
              data-testid="associate-search"
              type="text"
              value={query}
              onChange={(e) => { setQuery(e.target.value); }}
              // eslint-disable keepance-i18n/no-hardcoded-string
              placeholder="Search workflows..."
              aria-label="Search workflows"
              // eslint-enable keepance-i18n/no-hardcoded-string
              style={{
                border: 'none',
                outline: 'none',
                fontSize: 13,
                color: 'var(--kp-navy)',
                background: 'transparent',
                width: '100%',
                fontFamily: 'Satoshi, sans-serif',
              }}
            />
            {query && (
              <button
                type="button"
                onClick={() => { setQuery(''); }}
                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: 'var(--color-muted-foreground)' }}
                // eslint-disable keepance-i18n/no-hardcoded-string
                aria-label="Clear search"
                // eslint-enable keepance-i18n/no-hardcoded-string
              >
                <XCircle style={{ width: 13, height: 13 }} />
              </button>
            )}
          </div>
        </div>

        {/* Practice-area filter chips */}
        {presentCategories.length > 1 && (
          <div
            data-testid="associate-practice-filter"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              marginTop: 'var(--kp-stack-gap)',
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
      </div>

      {/* ── Banners ──────────────────────────────────────────────────── */}

      {/* Trial-expired banner */}
      {trialGate.isLocked && (
        <div
          data-testid="associate-trial-banner"
          style={{
            margin: 'var(--kp-space-sm) var(--kp-gutter) 0',
            padding: '10px 14px',
            borderRadius: 6,
            border: '1px solid #fbbf24',
            background: '#fffbeb',
            fontSize: 13,
            color: '#92400e',
          }}
        >
          {/* eslint-disable keepance-i18n/no-hardcoded-string */}
          <strong>Trial ended.</strong> Activate a license to run workflows. Your work is still here and fully accessible.
          {/* eslint-enable keepance-i18n/no-hardcoded-string */}
        </div>
      )}

      {/* Provider-error banner */}
      {providerError && (
        <div
          data-testid="associate-provider-error"
          role="alert"
          style={{
            margin: 'var(--kp-space-sm) var(--kp-gutter) 0',
            padding: '10px 14px',
            borderRadius: 6,
            border: '1px solid #fca5a5',
            background: '#fff1f2',
            fontSize: 13,
            color: '#7f1d1d',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            flexWrap: 'wrap',
          }}
        >
          <span style={{ flex: 1 }}>
            {providerError === 'ollama-unreachable' ? (
              <span>
                {/* eslint-disable keepance-i18n/no-hardcoded-string */}
                <strong>Local AI unreachable.</strong>
                {' Ollama is not responding. Check that it is running and try again.'}
                {/* eslint-enable keepance-i18n/no-hardcoded-string */}
              </span>
            ) : (
              <span>
                {/* eslint-disable keepance-i18n/no-hardcoded-string */}
                <strong>No AI provider configured.</strong>
                {' Add an API key or connect to Ollama to run workflows.'}
                {/* eslint-enable keepance-i18n/no-hardcoded-string */}
              </span>
            )}
          </span>
          {onOpenSettings && providerError === 'needs-provider' && (
            <button
              type="button"
              onClick={onOpenSettings}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                padding: '5px 12px',
                borderRadius: 5,
                fontSize: 12,
                fontWeight: 600,
                background: 'var(--kp-navy)',
                color: '#fff',
                border: 'none',
                cursor: 'pointer',
                flex: 'none',
              }}
            >
              <Settings style={{ width: 12, height: 12 }} />
              Open settings
            </button>
          )}
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
            <div
              style={{
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                color: 'var(--kp-navy)',
                marginBottom: 6,
              }}
            >
              Recent runs
            </div>
            <div
              data-testid="associate-recent-runs"
              style={{
                border: '1px solid var(--color-border)',
                borderRadius: 7,
                background: '#fff',
                overflow: 'hidden',
                padding: '0 14px',
              }}
            >
              {recentRuns.map((run) => (
                <RunRow
                  key={run.run_id}
                  run={run}
                  {...(onFocusExecutionTab !== undefined && { onFocus: onFocusExecutionTab })}
                />
              ))}
            </div>
          </div>
        )}

        {/* Template groups */}
        {groups.every((g) => g.templates.length === 0) ? (
          <div
            data-testid="associate-empty"
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '64px 0',
              gap: 12,
              textAlign: 'center',
            }}
          >
            <Search style={{ width: 32, height: 32, color: 'var(--color-muted-foreground)', strokeWidth: 1.5 }} />
            <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--kp-navy)' }}>
              {/* eslint-disable keepance-i18n/no-hardcoded-string */}
              No workflows match
              {/* eslint-enable keepance-i18n/no-hardcoded-string */}
            </div>
            <div style={{ fontSize: 13, color: 'var(--color-muted-foreground)', maxWidth: 280, lineHeight: 1.5 }}>
              {/* eslint-disable keepance-i18n/no-hardcoded-string */}
              Try a different search term, or clear the filter to see all workflows.
              {/* eslint-enable keepance-i18n/no-hardcoded-string */}
            </div>
            <button
              type="button"
              onClick={handleClearAll}
              style={{
                marginTop: 4,
                padding: '7px 16px',
                borderRadius: 5,
                fontSize: 13,
                fontWeight: 600,
                background: 'var(--kp-navy)',
                color: '#fff',
                border: 'none',
                cursor: 'pointer',
              }}
            >
              Clear search
            </button>
          </div>
        ) : (
          groups.map(({ config, templates: groupTemplates, totalCount }) => (
            <CategorySection
              key={config.key}
              config={config}
              templates={groupTemplates}
              totalCount={totalCount}
              searchActive={searchActive}
              featuredId={featuredId}
              currentExecution={currentExecution}
              trialLocked={trialGate.isLocked}
              collapsed={collapsedCategories[config.key] === true}
              onCollapse={handleCollapse}
              onRun={onStartWorkflow}
            />
          ))
        )}
      </div>
    </div>
  );
}
