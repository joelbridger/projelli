/**
 * AssociateHome — native full-page Workflows surface.
 *
 * Replaces the old "wrap WorkflowPanel" shim with a purpose-built,
 * grouped workflow library. The surface is self-contained: it loads
 * templates via loadAllTemplates(), groups them by category, and renders
 * a scannable rail with a search bar, one practice-area filter dropdown,
 * and recent runs. The only external seams are the five
 * props forwarded from App.tsx (unchanged interface so App.tsx needs no edits).
 *
 * Design:
 *  - Header: eyebrow "WORKFLOWS" + title "Workflows" + search box.
 *  - Practice-area filter dropdown derived from the actual categories present
 *    after profession scoping. "All workflows" shows everything; a specific
 *    category narrows the list. Search further narrows
 *    within the selected category (or across all when "All" is active).
 *  - "Start here" highlight on the primary first task for the legal profession
 *    (Deposition Contradiction Finder) — a subtle star cue.
 *  - Recent Runs strip using runHistory (last 4 for the selected workflow), each row clickable
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
import { Button, Eyebrow, Card, EmptyState, Callout, SearchField, RailShell, RailShellHeader, TrustNote } from '@/ui/kp';
import type { WorkflowTemplate, WorkflowExecution, RunRecord, WorkflowChain } from '@/platform/types/workflow';
import { loadAllTemplates } from '@/features/workflows/engine/userTemplates';
import { prioritizeByProfession } from '@/features/workflows/engine/prioritizeByProfession';
import type { Profession } from '@/features/workflows/engine/prioritizeByProfession';
import { useProfessionStore, isLawExperience } from '@/platform/profile/professionStore';
import { useTrialGate } from '@/platform/hooks/useTrial';
import { useConfidentialityMode } from '@/platform/hooks/useConfidentialityMode';
import { useActiveEgressProvider } from '@/platform/hooks/useActiveEgressProvider';
import {
  NO_AI_PROVIDER,
  providerDisplayName,
  resolveEgress,
  type ConfidentialityMode,
  type EgressProvider,
} from '@/platform/privacy/egress';
import { SK_WORKFLOWS_FILTER } from '@/config/identity';
import { getWorkflowLongDescription, getWorkflowShortDescription } from '@/features/workflows/workflowPresentation';

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
}

const CATEGORY_ORDER: CategoryConfig[] = [
  { key: 'legal' },
  { key: 'tax' },
  { key: 'consulting' },
  { key: 'advisors' },
  { key: 'research' },
  { key: 'analysis' },
  { key: 'planning' },
  { key: 'kickoff' },
  { key: 'custom' },
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

function categoryConfigFor(key: TemplateCategory): CategoryConfig {
  return CATEGORY_ORDER.find((cfg) => cfg.key === key) ?? {
    key,
  };
}

function categoryLabel(t: ReturnType<typeof useTranslation>['t'], key: TemplateCategory): string {
  return t(`workflow.associate.categories.${key}.label`);
}

function categoryDescription(t: ReturnType<typeof useTranslation>['t'], key: TemplateCategory): string {
  return t(`workflow.associate.categories.${key}.description`);
}

function runMatchesTemplate(run: RunRecord, template: WorkflowTemplate): boolean {
  return run.workflow === template.id || run.workflow === template.name;
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
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <SearchField
            data-testid="associate-search"
            value={query}
            onChange={onQueryChange}
            onClear={onQueryClear}
            placeholder={t('workflow.associate.search-placeholder')}
            size="sm"
            style={{ minWidth: 0, flex: 1 }}
          />
          {presentCategories.length > 1 && (
            <select
              data-testid="associate-practice-filter"
              aria-label={t('workflow.associate.filter-label')}
              value={activeFilter}
              onChange={(event) => { onFilterChange(event.target.value as FilterKey); }}
              style={{
                width: 118,
                height: 32,
                border: '1px solid var(--kp-divider)',
                borderRadius: 8,
                background: 'var(--color-background)',
                color: 'var(--kp-navy)',
                fontSize: 'var(--kp-font-xs)',
                fontWeight: 'var(--kp-weight-medium)',
                padding: '0 8px',
              }}
            >
              <option data-testid="associate-filter-all" value="all">
                {t('workflow.associate.filter-all')}
              </option>
              {presentCategories.map((cfg) => (
                <option
                  key={cfg.key}
                  data-testid={`associate-filter-${cfg.key}`}
                  value={cfg.key}
                >
                  {categoryLabel(t, cfg.key)}
                </option>
              ))}
            </select>
          )}
        </div>
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

  return (
    <div style={{ display: 'flex', minWidth: 0, flexDirection: 'column', gap: 4 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
        <span style={{ minWidth: 0, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 650 }}>
          {template.name}
        </span>
        {isFeatured ? (
          <Star
            aria-label={t('workflow.associate.start-here')}
            size={13}
            fill="currentColor"
            strokeWidth={2}
            style={{ flex: 'none', color: 'var(--kp-accent)' }}
          />
        ) : null}
        {isRunning ? <Loader2 size={13} strokeWidth={2} className="animate-spin" style={{ flex: 'none', color: 'var(--kp-accent)' }} /> : null}
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
        gap: 6,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Loader2 size={14} strokeWidth={2} className="animate-spin" style={{ color: 'var(--kp-accent)' }} />
        <span style={{ fontSize: 'var(--kp-font-xs)', fontWeight: 'var(--kp-weight-semibold)', color: 'var(--kp-navy)' }}>
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
  isRunning,
  trialLocked,
  executionActive,
  onRun,
}: {
  template: WorkflowTemplate;
  isRunning: boolean;
  trialLocked: boolean;
  executionActive: boolean;
  onRun: (t: WorkflowTemplate) => void;
}) {
  const { t } = useTranslation();
  const disabled = trialLocked || executionActive;

  return (
    <Button
      variant="primary"
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

function WorkflowTrustLine({
  provider,
  mode,
  onClick,
}: {
  provider: EgressProvider;
  mode: ConfidentialityMode;
  onClick?: () => void;
}) {
  const { t } = useTranslation();
  const isDisconnected = provider === NO_AI_PROVIDER;
  const info = isDisconnected ? null : resolveEgress({ provider, mode });
  const label = isDisconnected
    ? t('workflow.associate.trust-no-ai')
    : info?.destination === 'local'
      ? t('workflow.associate.trust-local')
      : info?.destination === 'assured-proxy'
        ? t('workflow.associate.trust-assured')
        : t('workflow.associate.trust-direct', { provider: providerDisplayName(provider) });
  const content = (
    <span data-testid="egress-indicator-label">{label}</span>
  );
  const destination = isDisconnected ? 'none' : info?.destination ?? 'provider-direct';
  const dataLeaves = info?.dataLeaves ? 'true' : 'false';
  const details = isDisconnected ? label : `${info?.label}. ${info?.note}`;
  const sharedProps = {
    'data-testid': 'egress-indicator',
    'data-destination': destination,
    'data-data-leaves': dataLeaves,
    details,
    variant: isDisconnected ? 'warning' as const : 'default' as const,
  };

  if (onClick) {
    return (
      <TrustNote
        {...sharedProps}
        role="button"
        tabIndex={0}
        aria-label={label}
        className="cursor-pointer"
        onClick={onClick}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            onClick();
          }
        }}
      >
        {content}
      </TrustNote>
    );
  }

  return (
    <TrustNote {...sharedProps}>
      {content}
    </TrustNote>
  );
}

function WorkflowDetail({
  template,
  currentExecution,
  trialLocked,
  recentRuns,
  missingArtifactRunIds,
  onRun,
  onFocusExecutionTab,
  onOpenArtifact,
  onOpenSettings,
  confidentialityMode,
  egressProvider,
}: {
  template: WorkflowTemplate;
  currentExecution: WorkflowExecution | null;
  trialLocked: boolean;
  recentRuns: RunRecord[];
  missingArtifactRunIds: Set<string>;
  onRun: (t: WorkflowTemplate) => void;
  onFocusExecutionTab?: () => void;
  onOpenArtifact?: (path: string, name: string, runId: string) => boolean | Promise<boolean>;
  onOpenSettings?: () => void;
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
  const metadata = [
    t('workflow.associate.steps-count', { count: stepCount }),
    t('workflow.associate.inputs-count', { count: requiredInputCount }),
    t('workflow.associate.outputs-count', { count: outputCount }),
  ].join(' · ');
  const shortDescription = getWorkflowShortDescription(template);
  const longDescription = getWorkflowLongDescription(template);
  const detailsDescription = longDescription ?? (template.description !== shortDescription ? template.description : null);
  const categoryDetails = categoryDescription(t, config.key);

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
          <Eyebrow primary>{categoryLabel(t, config.key)}</Eyebrow>
          <h1 style={{ margin: '6px 0 8px', fontSize: 'var(--kp-font-2xl)', fontWeight: 'var(--kp-weight-bold)', color: 'var(--kp-navy)', lineHeight: 'var(--kp-leading-tight)' }}>
            {template.name}
          </h1>
          <p style={{ margin: '0 0 8px', color: 'var(--color-muted-foreground)', fontSize: 'var(--kp-font-xs)', fontVariantNumeric: 'tabular-nums' }}>
            {metadata}
          </p>
          <p style={{ margin: 0, fontSize: 'var(--kp-font-sm)', lineHeight: 'var(--kp-leading-relaxed)', color: 'var(--color-muted-foreground)' }}>
            {shortDescription}
          </p>
          <details style={{ marginTop: 8 }}>
            <summary style={{ cursor: 'pointer', color: 'var(--kp-accent)', fontSize: 'var(--kp-font-xs)', fontWeight: 'var(--kp-weight-semibold)' }}>
              {t('workflow.associate.details')}
            </summary>
            <div style={{ display: 'grid', gap: 6, marginTop: 8, color: 'var(--color-muted-foreground)', fontSize: 'var(--kp-font-xs)', lineHeight: 'var(--kp-leading-relaxed)' }}>
              {detailsDescription ? <p style={{ margin: 0 }}>{detailsDescription}</p> : null}
              <p style={{ margin: 0 }}>{categoryDetails}</p>
            </div>
          </details>
        </div>
        <div style={{ display: 'flex', flexShrink: 0, flexDirection: 'column', alignItems: 'flex-end', gap: 10 }}>
          <WorkflowTrustLine
            provider={egressProvider}
            mode={confidentialityMode}
            {...(onOpenSettings !== undefined && { onClick: onOpenSettings })}
          />
          <WorkflowRunButton
            template={template}
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
                      padding: '10px 0',
                      borderBottom: template.steps.length > 5 ? '1px solid var(--kp-divider)' : 'none',
                    }}
                  >
                    {step.description ? (
                      <details>
                        <summary style={{ display: 'grid', gridTemplateColumns: '28px minmax(0, 1fr)', gap: 10, cursor: 'pointer', color: 'var(--kp-navy)', fontWeight: 'var(--kp-weight-semibold)', fontSize: 'var(--kp-font-sm)' }}>
                          <span style={{ color: 'var(--color-muted-foreground)', fontSize: 'var(--kp-font-xs)', fontVariantNumeric: 'tabular-nums' }}>
                            {String(index + 1)}
                          </span>
                          <span>{step.name}</span>
                        </summary>
                        <p style={{ margin: '6px 0 0 38px', color: 'var(--color-muted-foreground)', fontSize: 'var(--kp-font-xs)', lineHeight: 'var(--kp-leading-relaxed)' }}>
                          {step.description}
                        </p>
                      </details>
                    ) : (
                      <div style={{ display: 'grid', gridTemplateColumns: '28px minmax(0, 1fr)', gap: 10 }}>
                        <span style={{ color: 'var(--color-muted-foreground)', fontSize: 'var(--kp-font-xs)', fontVariantNumeric: 'tabular-nums' }}>
                          {String(index + 1)}
                        </span>
                        <span style={{ color: 'var(--kp-navy)', fontWeight: 'var(--kp-weight-semibold)', fontSize: 'var(--kp-font-sm)' }}>
                          {step.name}
                        </span>
                      </div>
                    )}
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
  // The active profession's category is floated to the top so the filter dropdown
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

  // Apply practice-area filter first to get the pre-search scope.
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

  const selectedWorkflow = useMemo(
    () => filtered.find((template) => template.id === selectedWorkflowId) ?? filtered[0] ?? null,
    [filtered, selectedWorkflowId],
  );

  const selectedWorkflowRuns = useMemo(
    () => selectedWorkflow
      ? runHistory.filter((run) => runMatchesTemplate(run, selectedWorkflow)).slice(0, 4)
      : [],
    [runHistory, selectedWorkflow],
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

  // When the filter changes, reset search so the state is consistent.
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
              recentRuns={selectedWorkflowRuns}
              missingArtifactRunIds={missingArtifactRunIds}
              onRun={onStartWorkflow}
              {...(onFocusExecutionTab !== undefined && { onFocusExecutionTab })}
              {...(onOpenRunArtifact !== undefined && { onOpenArtifact: handleOpenRecentRunArtifact })}
              {...(onOpenSettings !== undefined && { onOpenSettings })}
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
