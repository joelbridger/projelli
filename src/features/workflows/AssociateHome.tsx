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

import { useMemo, useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Play,
  CheckCircle2,
  XCircle,
  Clock,
  Search,
  Loader2,
  Star,
  Settings,
  AlertTriangle,
  AlertCircle,
} from 'lucide-react';
import { Button, Chip, Eyebrow, Card, EmptyState, Callout, SearchField, RailShell, RailShellHeader, Badge, TrustNote } from '@/ui/kp';
import type { WorkflowTemplate, WorkflowExecution, RunRecord, WorkflowChain } from '@/platform/types/workflow';
import { loadAllTemplates } from '@/features/workflows/engine/userTemplates';
import { prioritizeByProfession } from '@/features/workflows/engine/prioritizeByProfession';
import type { Profession } from '@/features/workflows/engine/prioritizeByProfession';
import { useProfessionStore, isLawExperience } from '@/platform/profile/professionStore';
import { useTrialGate } from '@/platform/hooks/useTrial';
import { useConfidentialityMode } from '@/platform/hooks/useConfidentialityMode';
import { useActiveEgressProvider } from '@/platform/hooks/useActiveEgressProvider';
import { NO_AI_PROVIDER } from '@/platform/privacy/egress';
import { SK_WORKFLOWS_FILTER } from '@/config/identity';

// ── Prop interface (kept identical to original) ────────────────────────────

interface AssociateHomeProps {
  onStartWorkflow: (template: WorkflowTemplate) => void;
  currentExecution: WorkflowExecution | null;
  runHistory: RunRecord[];
  providerError?: 'needs-provider' | 'ollama-unreachable' | 'needs-client' | null;
  /** BUG F2 — set when a run's terminal .workflow record failed to save to
   *  disk after retries. Non-blocking (unlike `providerError`): the run
   *  itself finished and its deliverable may be fine, only the audit/replay
   *  record is at risk, so this renders as a dismissible-feeling warning
   *  banner rather than a hard stop. */
  saveError?: string | null;
  onOpenSettings?: () => void;
  onFocusExecutionTab?: () => void;
  onOpenRunArtifact?: (path: string, name: string) => boolean | Promise<boolean>;
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
      size="pill"
      data-testid={testId}
      onClick={onClick}
    >
      {label}
    </Chip>
  );
}

function categoryConfigFor(key: TemplateCategory): CategoryConfig {
  return CATEGORY_ORDER.find((cfg) => cfg.key === key) ?? {
    key,
    label: key,
    description: '',
  };
}

function WorkflowRailHeader({
  presentCategories,
  activeFilter,
  query,
  onFilterChange,
  onQueryChange,
  onQueryClear,
}: {
  presentCategories: CategoryConfig[];
  activeFilter: FilterKey;
  query: string;
  onFilterChange: (key: FilterKey) => void;
  onQueryChange: (query: string) => void;
  onQueryClear: () => void;
}) {
  const { t } = useTranslation();

  return (
    <div data-testid="associate-workflows-rail" style={{ flex: 'none' }}>
      <RailShellHeader title={t('spine.nav.workflows')} />
      <div
        data-testid="associate-toolbar"
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          padding: '10px 12px 12px',
          borderBottom: '1px solid var(--kp-divider)',
        }}
      >
        <SearchField
          data-testid="associate-search"
          value={query}
          onChange={onQueryChange}
          onClear={onQueryClear}
          placeholder={t('workflow.associate.search-placeholder')}
          size="sm"
          style={{ width: '100%' }}
        />
        {presentCategories.length > 1 && (
          <div
            data-testid="associate-practice-filter"
            aria-label={t('workflow.associate.filter-label')}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              flexWrap: 'wrap',
            }}
          >
            <PracticeFilterChip
              label={t('workflow.associate.filter-all')}
              active={activeFilter === 'all'}
              testId="associate-filter-all"
              onClick={() => { onFilterChange('all'); }}
            />
            {presentCategories.map((cfg) => (
              <PracticeFilterChip
                key={cfg.key}
                label={cfg.label}
                active={activeFilter === cfg.key}
                testId={`associate-filter-${cfg.key}`}
                onClick={() => { onFilterChange(cfg.key); }}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function WorkflowRailRow({
  template,
  isFeatured,
  isRunning,
}: {
  template: WorkflowTemplate;
  isFeatured: boolean;
  isRunning: boolean;
}) {
  const { t } = useTranslation();
  const config = categoryConfigFor(template.category);

  return (
    <div style={{ display: 'flex', minWidth: 0, flexDirection: 'column', gap: 4 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
        <span style={{ minWidth: 0, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 650 }}>
          {template.name}
        </span>
        {isRunning ? <Loader2 size={13} strokeWidth={2} className="animate-spin" style={{ flex: 'none', color: 'var(--kp-accent)' }} /> : null}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
        <span style={{ minWidth: 0, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 'var(--kp-font-2xs)', color: 'var(--kp-side-fg-dim)' }}>
          {config.label}
        </span>
        {isFeatured ? (
          <Badge variant="featured" size="sm" icon={Star} uppercase>
            {t('workflow.associate.start-here')}
          </Badge>
        ) : null}
      </div>
    </div>
  );
}

function WorkflowProgress({ currentExecution }: { currentExecution: WorkflowExecution }) {
  const { t } = useTranslation();
  const total = Math.max(currentExecution.template.steps.length, 1);
  const current = Math.min(currentExecution.currentStepIndex + 1, total);
  const width = `${String(Math.round((current / total) * 100))}%`;

  return (
    <div
      data-testid="associate-live-progress"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        padding: '12px 14px',
        border: '1px solid var(--kp-divider)',
        borderRadius: 8,
        background: 'var(--kp-bg-soft)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Loader2 size={16} strokeWidth={2} className="animate-spin" style={{ color: 'var(--kp-accent)' }} />
        <span style={{ fontSize: 'var(--kp-font-sm)', fontWeight: 'var(--kp-weight-bold)', color: 'var(--kp-navy)' }}>
          {t('workflow.associate.live-run')}
        </span>
        <span style={{ marginLeft: 'auto', fontSize: 'var(--kp-font-xs)', color: 'var(--color-muted-foreground)', fontVariantNumeric: 'tabular-nums' }}>
          {t('workflow.associate.step-progress', { current, total })}
        </span>
      </div>
      <div style={{ height: 6, borderRadius: 999, background: 'var(--kp-divider)', overflow: 'hidden' }}>
        <div style={{ height: '100%', width, borderRadius: 999, background: 'var(--kp-accent)' }} />
      </div>
    </div>
  );
}

function WorkflowRunButton({
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
  const { t } = useTranslation();
  const disabled = trialLocked || executionActive;

  return (
    <Button
      variant={isFeatured ? 'primary' : 'secondary'}
      size="md"
      iconLeft={isRunning ? Loader2 : Play}
      loading={isRunning}
      data-testid={`associate-run-${template.id}`}
      disabled={disabled}
      onClick={() => { if (!disabled) onRun(template); }}
      title={trialLocked ? t('workflow.associate.trial-ended-title') : t('workflow.associate.run-workflow', { name: template.name })}
    >
      {isRunning ? t('workflow.associate.running') : t('workflow.associate.run')}
    </Button>
  );
}

function WorkflowDetail({
  template,
  currentExecution,
  trialLocked,
  featuredId,
  recentRuns,
  missingArtifactRunIds,
  onRun,
  onFocusExecutionTab,
  onOpenArtifact,
  confidentialityMode,
  egressProvider,
}: {
  template: WorkflowTemplate;
  currentExecution: WorkflowExecution | null;
  trialLocked: boolean;
  featuredId: string | null;
  recentRuns: RunRecord[];
  missingArtifactRunIds: Set<string>;
  onRun: (t: WorkflowTemplate) => void;
  onFocusExecutionTab?: () => void;
  onOpenArtifact?: (path: string, name: string, runId: string) => boolean | Promise<boolean>;
  confidentialityMode: ReturnType<typeof useConfidentialityMode>;
  egressProvider: ReturnType<typeof useActiveEgressProvider>;
}) {
  const { t } = useTranslation();
  const config = categoryConfigFor(template.category);
  const runningExecution = currentExecution?.template.id === template.id ? currentExecution : null;
  const isRunning = runningExecution !== null;
  const isAnotherWorkflowRunning = currentExecution !== null && runningExecution === null;
  const stepCount = template.steps.length;
  const requiredInputCount = template.requiredInputs.length;
  const outputCount = template.outputs.length;

  return (
    <div
      data-testid="associate-workflow-detail"
      style={{
        display: 'flex',
        minHeight: 0,
        flex: 1,
        flexDirection: 'column',
        overflowY: 'auto',
        background: 'var(--color-background)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', padding: '22px 28px 18px', borderBottom: '1px solid var(--kp-divider)' }}>
        <div style={{ minWidth: 0, maxWidth: 780 }}>
          <Eyebrow primary>{config.label}</Eyebrow>
          <h1 style={{ margin: '6px 0 8px', fontSize: 'var(--kp-font-2xl)', fontWeight: 'var(--kp-weight-bold)', color: 'var(--kp-navy)', lineHeight: 'var(--kp-leading-tight)' }}>
            {template.name}
          </h1>
          <p style={{ margin: 0, fontSize: 'var(--kp-font-sm)', lineHeight: 'var(--kp-leading-relaxed)', color: 'var(--color-muted-foreground)' }}>
            {template.description}
          </p>
        </div>
        <div style={{ display: 'flex', flexShrink: 0, flexDirection: 'column', alignItems: 'flex-end', gap: 10 }}>
          {/* F1: trust AT ACTION TIME. The always-visible egress STATUS lives once
              in the top bar; here, next to Run, a quiet one-line TrustNote says
              where this run will send data — not a third copy of the status pill. */}
          {(() => {
            const noProvider = !egressProvider || egressProvider === NO_AI_PROVIDER;
            const isLocalDest =
              confidentialityMode === 'local-only' ||
              egressProvider === 'ollama' ||
              egressProvider === 'lantern-local';
            if (noProvider) {
              return <TrustNote variant="warning">{t('workflow.associate.egress-none')}</TrustNote>;
            }
            return (
              <TrustNote>
                {isLocalDest
                  ? t('workflow.associate.egress-local')
                  : t('workflow.associate.egress-cloud')}
              </TrustNote>
            );
          })()}
          <WorkflowRunButton
            template={template}
            isFeatured={template.id === featuredId}
            isRunning={isRunning}
            trialLocked={trialLocked}
            executionActive={currentExecution !== null}
            onRun={onRun}
          />
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 24, flexWrap: 'wrap', padding: '22px 28px 28px', minHeight: 0 }}>
        <div style={{ display: 'flex', minWidth: 280, flex: '1 1 480px', flexDirection: 'column', gap: 18 }}>
          {runningExecution ? <WorkflowProgress currentExecution={runningExecution} /> : null}

          {isAnotherWorkflowRunning ? (
            <div data-testid="associate-other-workflow-running">
              <Callout variant="info" icon={Clock}>
                <strong>{t('workflow.associate.other-running-title')}</strong>{' '}
                {t('workflow.associate.other-running-body')}
              </Callout>
            </div>
          ) : null}

          <section>
            <Eyebrow primary>{t('workflow.associate.steps')}</Eyebrow>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
              {template.steps.length > 0 ? (
                template.steps.map((step, index) => (
                  <div
                    key={step.id}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '28px minmax(0, 1fr)',
                      gap: 10,
                      padding: '10px 0',
                      borderBottom: '1px solid var(--kp-divider)',
                    }}
                  >
                    <span style={{ color: 'var(--color-muted-foreground)', fontSize: 'var(--kp-font-xs)', fontVariantNumeric: 'tabular-nums' }}>
                      {String(index + 1)}
                    </span>
                    <span style={{ minWidth: 0 }}>
                      <span style={{ display: 'block', color: 'var(--kp-navy)', fontWeight: 'var(--kp-weight-semibold)', fontSize: 'var(--kp-font-sm)' }}>
                        {step.name}
                      </span>
                      <span style={{ display: 'block', color: 'var(--color-muted-foreground)', fontSize: 'var(--kp-font-xs)', lineHeight: 'var(--kp-leading-relaxed)', marginTop: 2 }}>
                        {step.description}
                      </span>
                    </span>
                  </div>
                ))
              ) : (
                <p style={{ margin: '8px 0 0', color: 'var(--color-muted-foreground)', fontSize: 'var(--kp-font-sm)' }}>
                  {t('workflow.associate.no-steps')}
                </p>
              )}
            </div>
          </section>

          {recentRuns.length > 0 && (
            <section>
              <div style={{ marginBottom: 6 }}>
                <Eyebrow primary>{t('workflow.associate.recent-runs')}</Eyebrow>
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
                    fileMissing={missingArtifactRunIds.has(run.run_id)}
                    {...(onFocusExecutionTab !== undefined && { onFocus: onFocusExecutionTab })}
                    {...(onOpenArtifact !== undefined && { onOpenArtifact })}
                  />
                ))}
              </Card>
            </section>
          )}
        </div>

        <aside style={{ display: 'flex', minWidth: 220, flex: '1 1 260px', maxWidth: 320, flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 8 }}>
            <Badge variant="neutral" size="md">
              {t('workflow.associate.steps-count', { count: stepCount })}
            </Badge>
            <Badge variant="neutral" size="md">
              {t('workflow.associate.required-inputs-count', { count: requiredInputCount })}
            </Badge>
            <Badge variant="neutral" size="md">
              {t('workflow.associate.outputs-count', { count: outputCount })}
            </Badge>
          </div>
          <div style={{ borderTop: '1px solid var(--kp-divider)', paddingTop: 12 }}>
            <Eyebrow>{t('workflow.associate.category')}</Eyebrow>
            <p style={{ margin: '6px 0 0', color: 'var(--color-muted-foreground)', fontSize: 'var(--kp-font-xs)', lineHeight: 'var(--kp-leading-relaxed)' }}>
              {config.description}
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}

/** Single recent-run row. */
function RunRow({
  run,
  onFocus,
  onOpenArtifact,
  fileMissing,
}: {
  run: RunRecord;
  onFocus?: () => void;
  onOpenArtifact?: (path: string, name: string, runId: string) => boolean | Promise<boolean>;
  fileMissing: boolean;
}) {
  const { t } = useTranslation();
  const statusIcon =
    fileMissing ? (
      <AlertTriangle style={{ width: 'var(--kp-icon-sm)', height: 'var(--kp-icon-sm)', color: 'var(--kp-warning)', flex: 'none' }} />
    ) : run.status === 'completed' ? (
      <CheckCircle2 style={{ width: 'var(--kp-icon-sm)', height: 'var(--kp-icon-sm)', color: '#22c55e', flex: 'none' }} />
    ) : run.status === 'failed' ? (
      <XCircle style={{ width: 'var(--kp-icon-sm)', height: 'var(--kp-icon-sm)', color: '#ef4444', flex: 'none' }} />
    ) : (
      <Clock style={{ width: 'var(--kp-icon-sm)', height: 'var(--kp-icon-sm)', color: 'var(--color-muted-foreground)', flex: 'none' }} />
    );
  const artifact = getRunArtifact(run, t('workflow.associate.workflow-result'));
  const displayTitle = getRunDisplayTitle(run);

  return (
    <button
      type="button"
      data-testid={`associate-run-row-${run.run_id}`}
      data-file-missing={fileMissing ? 'true' : 'false'}
      onClick={() => {
        if (artifact && onOpenArtifact) {
          void onOpenArtifact(artifact.path, artifact.name, run.run_id);
          return;
        }
        onFocus?.();
      }}
      title={artifact?.path ?? run.workflow}
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
        cursor: artifact || onFocus ? 'pointer' : 'default',
      }}
    >
      {statusIcon}
      <span
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          gap: 2,
          minWidth: 0,
        }}
      >
        <span
          style={{
            fontSize: 'var(--kp-font-sm)',
            color: 'var(--kp-navy)',
            fontWeight: 'var(--kp-weight-medium)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {displayTitle}
        </span>
        <span
          style={{
            fontSize: 'var(--kp-font-2xs)',
            color: 'var(--color-muted-foreground)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {fileMissing ? t('workflow.associate.file-missing') : artifact ? artifact.name : run.workflow}
        </span>
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

function stringOutput(run: RunRecord, key: string): string | null {
  const value = run.outputs[key];
  return typeof value === 'string' && value.trim() ? value : null;
}

function getRunDisplayTitle(run: RunRecord): string {
  return stringOutput(run, 'displayTitle') ?? run.workflow;
}

function getRunArtifact(run: RunRecord, fallbackName: string): { path: string; name: string } | null {
  const path = stringOutput(run, 'primaryArtifactPath');
  if (!path) return null;
  const name = stringOutput(run, 'primaryArtifactName') ?? path.split(/[\\/]/).pop() ?? fallbackName;
  return { path, name };
}

// ── Main export ────────────────────────────────────────────────────────────

export function AssociateHome({
  onStartWorkflow,
  currentExecution,
  runHistory,
  providerError,
  saveError,
  onOpenSettings,
  onFocusExecutionTab,
  onOpenRunArtifact,
}: AssociateHomeProps) {
  const { t } = useTranslation();
  const trialGate = useTrialGate();
  const profession = useProfessionStore((s) => s.profession);
  // Workflows run AI — show the same egress badge as Ask, top-right.
  const confidentialityMode = useConfidentialityMode();
  const egressProvider = useActiveEgressProvider(confidentialityMode);
  const [query, setQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState<FilterKey>(readStoredFilter);
  const [missingArtifactRunIds, setMissingArtifactRunIds] = useState<Set<string>>(() => new Set());
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string | null>(null);

  // Persist filter to localStorage whenever it changes.
  useEffect(() => {
    writeStoredFilter(activeFilter);
  }, [activeFilter]);

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

  // Apply search query within the category-filtered scope.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return categoryFiltered;
    return categoryFiltered.filter((t) => {
      const hay = `${t.name} ${t.description} ${t.category}`.toLowerCase();
      return hay.includes(q);
    });
  }, [categoryFiltered, query]);

  // Featured template: first task in the legal profession (starts-here hint).
  const featuredId = isLawExperience(profession) ? LAW_FEATURED_ID : null;

  const recentRuns = runHistory.slice(0, 4);

  const selectedWorkflow = useMemo(
    () => filtered.find((template) => template.id === selectedWorkflowId) ?? filtered[0] ?? null,
    [filtered, selectedWorkflowId],
  );

  const railItems = useMemo(
    () =>
      filtered.map((template) => ({
        id: template.id,
        label: template.name,
        content: (
          <WorkflowRailRow
            template={template}
            isFeatured={template.id === featuredId}
            isRunning={currentExecution?.template.id === template.id}
          />
        ),
        testId: `associate-workflow-row-${template.id}`,
        ariaLabel: template.name,
      })),
    [currentExecution, featuredId, filtered],
  );

  const handleOpenRecentRunArtifact = useCallback(
    async (path: string, name: string, runId: string): Promise<boolean> => {
      if (!onOpenRunArtifact) return false;
      const opened = await onOpenRunArtifact(path, name);
      setMissingArtifactRunIds((prev) => {
        const next = new Set(prev);
        if (opened) {
          next.delete(runId);
        } else {
          next.add(runId);
        }
        return next;
      });
      return opened;
    },
    [onOpenRunArtifact],
  );

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

  return (
    <div
      data-testid="associate-home"
      style={{
        display: 'flex',
        height: '100%',
        flex: 1,
        minHeight: 0,
        minWidth: 0,
        background: 'var(--color-background)',
        fontFamily: 'Satoshi, sans-serif',
        overflow: 'hidden',
      }}
    >
      <RailShell
        header={
          <WorkflowRailHeader
            presentCategories={presentCategories}
            activeFilter={activeFilter}
            query={query}
            onFilterChange={handleFilterChange}
            onQueryChange={setQuery}
            onQueryClear={() => { setQuery(''); }}
          />
        }
        listAriaLabel={t('workflow.associate.rail-list-label')}
        items={railItems}
        activeId={selectedWorkflow?.id ?? null}
        onSelect={setSelectedWorkflowId}
        railWidth={284}
        emptyState={
          <span style={{ color: 'var(--color-muted-foreground)', fontSize: 'var(--kp-font-xs)' }}>
            {t('workflow.associate.empty-title')}
          </span>
        }
        className="min-h-0 flex-1"
        contentClassName="bg-[var(--color-background)]"
      >
        <div style={{ display: 'flex', minHeight: 0, flex: 1, flexDirection: 'column' }}>
          {trialGate.isLocked && (
            <div
              data-testid="associate-trial-banner"
              style={{ padding: '14px 28px 0' }}
            >
              <Callout variant="warning" icon={AlertTriangle}>
                <strong>{t('workflow.panel.trial-ended-label')}</strong>{' '}
                {t('workflow.associate.trial-ended-description')}
              </Callout>
            </div>
          )}

          {providerError && (
            <div
              data-testid="associate-provider-error"
              role="alert"
              style={{ padding: '14px 28px 0' }}
            >
              <Callout variant="error" icon={AlertCircle}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <span style={{ flex: 1 }}>
                    {providerError === 'needs-client' ? (
                      <span>
                        <strong>{t('workflow.associate.needs-client-title')}</strong>
                        {' '}
                        {t('workflow.associate.needs-client-body')}
                      </span>
                    ) : providerError === 'ollama-unreachable' ? (
                      <span>
                        <strong>{t('workflow.associate.ollama-unreachable-title')}</strong>
                        {' '}
                        {t('workflow.associate.ollama-unreachable-body')}
                      </span>
                    ) : (
                      <span>
                        <strong>{t('workflow.associate.needs-provider-title')}</strong>
                        {' '}
                        {t('workflow.associate.needs-provider-body')}
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
                      {t('workflow.execution.needs-provider-action')}
                    </Button>
                  )}
                </div>
              </Callout>
            </div>
          )}

          {saveError && (
            <div
              data-testid="associate-save-error"
              role="alert"
              style={{ padding: '14px 28px 0' }}
            >
              <Callout variant="warning" icon={AlertTriangle}>
                <strong>{t('workflow.associate.save-error-title')}</strong> {saveError}
              </Callout>
            </div>
          )}

          {selectedWorkflow ? (
            <WorkflowDetail
              template={selectedWorkflow}
              currentExecution={currentExecution}
              trialLocked={trialGate.isLocked}
              featuredId={featuredId}
              recentRuns={recentRuns}
              missingArtifactRunIds={missingArtifactRunIds}
              onRun={onStartWorkflow}
              {...(onFocusExecutionTab !== undefined && { onFocusExecutionTab })}
              {...(onOpenRunArtifact !== undefined && { onOpenArtifact: handleOpenRecentRunArtifact })}
              confidentialityMode={confidentialityMode}
              egressProvider={egressProvider}
            />
          ) : (
            <div style={{ display: 'grid', minHeight: 0, flex: 1, placeItems: 'center', padding: 28 }}>
              <EmptyState
                data-testid="associate-empty"
                icon={Search}
                title={t('workflow.associate.empty-title')}
                body={t('workflow.associate.empty-body')}
                actions={
                  <Button variant="secondary" size="sm" onClick={handleClearAll}>
                    {t('workflow.associate.clear-search')}
                  </Button>
                }
              />
            </div>
          )}
        </div>
      </RailShell>
    </div>
  );
}
