// Workflow Panel Component
// UI for starting and managing workflows
//
// Wave 3 UX-09 changes:
//   - Outer container uses `h-full flex flex-col` so the list region fills all
//     available sidebar height (the old panel was a single scroll body that
//     got squeezed to ~131px on short sidebars).
//   - Added a "Open full view" button in the header that opens a Radix Dialog
//     showing every workflow in a 3-column grid with a live search/filter.
//     The modal has a real <DialogTitle> for a11y (no repeat of UX-02).

import { useEffect, useMemo, useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  Play,
  Clock,
  CheckCircle,
  AlertCircle,
  Loader2,
  Maximize2,
  Search,
  Copy,
  Trash2,
  Link as LinkIcon,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import type { WorkflowTemplate, WorkflowExecution, RunRecord, WorkflowChain } from '@/types/workflow';
import {
  duplicateTemplate,
  deleteUserTemplate,
  getSystemPrompt,
  loadAllTemplates,
  saveUserTemplate,
  setSystemPrompt,
} from '@/modules/workflow/userTemplates';
import { ChainBuilderModal } from './ChainBuilderModal';
import { useTrialGate } from '@/hooks/useTrial';
import { useTemplatesMarketplace } from '@/hooks/useTemplatesMarketplace';
import {
  TEMPLATE_PROVENANCE_LABELS,
  type TemplateProvenance,
} from '@/modules/marketplace';

interface WorkflowPanelProps {
  onStartWorkflow: (template: WorkflowTemplate) => void;
  currentExecution: WorkflowExecution | null;
  runHistory: RunRecord[];
  /** Callback to focus the workflow-execution tab in the main panel. */
  onFocusExecutionTab?: () => void;
  /**
   * M7 — optional callback fired when the user saves + runs a chain. The
   * app owns the engine, so the panel just hands back the saved chain.
   */
  onRunChain?: (chain: WorkflowChain) => void;
}

export function WorkflowPanel({
  onStartWorkflow,
  currentExecution,
  runHistory,
  onFocusExecutionTab,
  onRunChain,
}: WorkflowPanelProps) {
  // 30-day trial gate. Locks template + chain runs when expired and not paid.
  const trialGate = useTrialGate();
  const [showFullView, setShowFullView] = useState(false);
  // M7 — chain builder open state
  const [showChainBuilder, setShowChainBuilder] = useState(false);
  // Q19 — combined built-ins + user templates. `version` triggers re-read
  // after a save or delete so the picker reflects the change.
  const [templatesVersion, setTemplatesVersion] = useState(0);
  const localWorkflows = useMemo(
    () => loadAllTemplates(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [templatesVersion]
  );

  // Stream C1 — Surface marketplace-installed community templates alongside
  // built-ins + user templates. The marketplace store is workspace-scoped;
  // when no workspace is active, the service is null and we render only the
  // local list. We re-read whenever the installed list changes (best-effort
  // signal: refresh on `templatesVersion` ticks + on first paint of the
  // panel after a workspace mounts).
  const { service, reader, updateCount } = useTemplatesMarketplace();
  const [communityWorkflows, setCommunityWorkflows] = useState<WorkflowTemplate[]>([]);
  useEffect(() => {
    let cancelled = false;
    if (!service || !reader) {
      setCommunityWorkflows([]);
      return;
    }
    void (async () => {
      try {
        const list = await reader.list(service);
        if (!cancelled) setCommunityWorkflows(list);
      } catch {
        if (!cancelled) setCommunityWorkflows([]);
      }
    })();
    return () => {
      cancelled = true;
    };
    // updateCount is included so a successful checkForUpdates / install /
    // uninstall — which all flow through the marketplace store — triggers a
    // re-read of the community list. Group VIII is responsible for keeping
    // updateCount in sync; for now it ticks on install + uninstall via the
    // store nav badge plumbing.
  }, [reader, service, templatesVersion, updateCount]);

  const availableWorkflows = useMemo(() => {
    // De-dupe by id: a community template with the same id as a user
    // template (rare, but possible after a remix workflow) lets the user
    // copy win, matching `loadAllTemplates`'s precedence rules.
    const seen = new Set(localWorkflows.map((t) => t.id));
    return [
      ...localWorkflows,
      ...communityWorkflows.filter((t) => !seen.has(t.id)),
    ];
  }, [localWorkflows, communityWorkflows]);

  const refreshTemplates = useCallback(
    () => setTemplatesVersion((v) => v + 1),
    []
  );

  // Q19 — fork modal state.
  const [forkOriginal, setForkOriginal] = useState<WorkflowTemplate | null>(null);

  const handleStartClick = (template: WorkflowTemplate) => {
    if (trialGate.isLocked) return;
    onStartWorkflow(template);
  };

  const startFromModal = (template: WorkflowTemplate) => {
    if (trialGate.isLocked) return;
    onStartWorkflow(template);
    setShowFullView(false);
  };

  const handleDuplicate = useCallback((template: WorkflowTemplate) => {
    setForkOriginal(template);
  }, []);

  const handleDelete = useCallback(
    (template: WorkflowTemplate) => {
      if (!template.isUser) return;
      if (
        typeof window !== 'undefined' &&
        typeof window.confirm === 'function' &&
        !window.confirm(`Delete template "${template.name}"? This cannot be undone.`)
      ) {
        return;
      }
      deleteUserTemplate(template.id);
      refreshTemplates();
    },
    [refreshTemplates]
  );

  const handleForkSaved = useCallback(() => {
    setForkOriginal(null);
    refreshTemplates();
  }, [refreshTemplates]);

  return (
    <div
      data-testid="workflows-panel"
      className="h-full flex flex-col overflow-hidden"
    >
      {/* Trial-expired banner. Sits at the very top so the user sees
           why the run buttons below are disabled. */}
      {trialGate.isLocked && (
        <div
          data-testid="workflows-trial-expired-banner"
          className="mx-3 mt-3 mb-1 px-3 py-2 rounded border border-amber-400/50 bg-amber-50 dark:bg-amber-900/20 text-amber-900 dark:text-amber-200 text-xs shrink-0"
        >
          <strong>Trial ended.</strong>{' '}
          Activate a license in Settings → License to run workflows.
        </div>
      )}
      {/* Header — sized for the narrow sidebar slot. Title truncates,
          actions collapse to icon-only with tooltips so nothing runs
          off the right edge. */}
      <div className="flex items-center justify-between gap-2 px-3 pt-3 pb-2 shrink-0">
        <h3 className="text-sm font-semibold min-w-0 truncate">Workflows</h3>
        <div className="flex items-center gap-0.5 shrink-0">
          <Button
            data-testid="workflows-chain-templates"
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0"
            onClick={() => setShowChainBuilder(true)}
            title="Chain templates into a multi-step pipeline"
            aria-label="Chain templates"
          >
            <LinkIcon className="h-3.5 w-3.5" />
          </Button>
          <Button
            data-testid="workflows-open-full-view"
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0"
            onClick={() => setShowFullView(true)}
            title="Open full view"
            aria-label="Open full view"
          >
            <Maximize2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Scrollable list region — takes all remaining sidebar height */}
      <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-4">
        <GroupedWorkflowList
          workflows={availableWorkflows}
          currentExecution={currentExecution}
          trialLocked={trialGate.isLocked}
          onStart={handleStartClick}
          onDuplicate={handleDuplicate}
          onDelete={handleDelete}
        />

        {currentExecution && (
          <div>
            <h3 className="text-sm font-semibold mb-3">Current Execution</h3>
            <Card
              className="cursor-pointer hover:bg-muted/50 transition-colors"
              onClick={onFocusExecutionTab}
            >
              <CardContent className="p-3">
                <div className="flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin text-amber-500" />
                  <div className="flex-1 min-w-0">
                    <span className="text-sm font-medium block truncate">
                      {currentExecution.template.name}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      Step {currentExecution.currentStepIndex + 1} of{' '}
                      {currentExecution.template.steps.length} &mdash; click to view
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {runHistory.length > 0 && (
          <div>
            <h3 className="text-sm font-semibold mb-3">Run History</h3>
            <div className="space-y-2">
              {runHistory.slice(0, 5).map((run) => (
                <Card key={run.run_id}>
                  <CardContent className="p-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        {run.status === 'completed' ? (
                          <CheckCircle className="h-4 w-4 text-green-500" />
                        ) : run.status === 'failed' ? (
                          <AlertCircle className="h-4 w-4 text-red-500" />
                        ) : (
                          <Clock className="h-4 w-4 text-muted-foreground" />
                        )}
                        <span className="text-sm">{run.workflow}</span>
                      </div>
                      <span className="text-xs text-muted-foreground">
                        {formatRelativeTime(run.start_time)}
                      </span>
                    </div>
                    {run.status === 'failed' && run.error && (
                      <p className="text-xs text-red-500 mt-1">{run.error}</p>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Full-view modal (UX-09) */}
      <WorkflowsFullViewModal
        open={showFullView}
        onOpenChange={setShowFullView}
        currentExecution={currentExecution}
        onStartWorkflow={startFromModal}
        templates={availableWorkflows}
        onDuplicate={handleDuplicate}
        onDelete={handleDelete}
      />

      {/* Q19 — fork / remix modal */}
      <TemplateForkModal
        original={forkOriginal}
        onClose={() => setForkOriginal(null)}
        onSaved={handleForkSaved}
      />

      {/* M7 — chain builder */}
      <ChainBuilderModal
        open={showChainBuilder}
        onOpenChange={setShowChainBuilder}
        templates={availableWorkflows}
        onRun={onRunChain}
      />
    </div>
  );
}

interface WorkflowsFullViewModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentExecution: WorkflowExecution | null;
  onStartWorkflow: (template: WorkflowTemplate) => void;
  templates: WorkflowTemplate[];
  onDuplicate: (template: WorkflowTemplate) => void;
  onDelete: (template: WorkflowTemplate) => void;
}

function WorkflowsFullViewModal({
  open,
  onOpenChange,
  currentExecution,
  onStartWorkflow,
  templates,
  onDuplicate,
  onDelete,
}: WorkflowsFullViewModalProps) {
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return templates;
    return templates.filter((w) => {
      const hay = `${w.name} ${w.description}`.toLowerCase();
      return hay.includes(q);
    });
  }, [query, templates]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-testid="workflows-modal"
        className="max-w-5xl w-[90vw] max-h-[90vh] overflow-hidden flex flex-col p-0"
      >
        <DialogHeader className="px-6 pt-6 pb-3 border-b shrink-0">
          <DialogTitle>All workflows</DialogTitle>
          <DialogDescription>
            Pre-built AI workflows for founders. Pick one to start a guided conversation.
          </DialogDescription>
        </DialogHeader>

        <div className="px-6 py-3 border-b shrink-0">
          <div className="flex items-center gap-2 border rounded-md px-2 py-1.5">
            <Search className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <Input
              data-testid="workflows-modal-search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search workflows..."
              className="border-0 h-6 px-0 focus-visible:ring-0 text-sm"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          {filtered.length === 0 ? (
            <p
              data-testid="workflows-modal-empty"
              className="text-sm text-muted-foreground text-center py-8"
            >
              No workflows match "{query}".
            </p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {filtered.map((workflow) => (
                <Card
                  key={workflow.id}
                  data-testid={`workflow-modal-card-${workflow.id}`}
                  className="flex flex-col"
                >
                  <CardHeader className="p-4 pb-3 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <CardTitle className="text-sm leading-snug flex-1">
                        {workflow.name}
                      </CardTitle>
                      <ProvenanceCardBadge
                        provenance={resolveProvenance(workflow)}
                        templateId={`modal-${workflow.id}`}
                      />
                      {workflow.isUser && (
                        <span
                          data-testid={`workflow-modal-user-badge-${workflow.id}`}
                          className="text-[10px] font-medium uppercase tracking-wide bg-primary/10 text-primary px-1.5 py-0.5 rounded shrink-0"
                        >
                          Custom
                        </span>
                      )}
                    </div>
                    <CardDescription className="text-xs mt-2 line-clamp-4">
                      {workflow.description}
                    </CardDescription>
                  </CardHeader>
                  <div className="px-4 pb-4 flex items-center gap-1.5">
                    <Button
                      size="sm"
                      className="flex-1 h-8"
                      onClick={() => onStartWorkflow(workflow)}
                      disabled={currentExecution !== null}
                    >
                      {currentExecution?.template.id === workflow.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                      ) : (
                        <Play className="h-3.5 w-3.5 mr-1.5" />
                      )}
                      Start
                    </Button>
                    <Button
                      data-testid={`workflow-modal-duplicate-${workflow.id}`}
                      size="sm"
                      variant="outline"
                      className="h-8 w-8 p-0"
                      onClick={() => onDuplicate(workflow)}
                      aria-label={`Duplicate ${workflow.name}`}
                      title="Duplicate this template"
                    >
                      <Copy className="h-3.5 w-3.5" />
                    </Button>
                    {workflow.isUser && (
                      <Button
                        data-testid={`workflow-modal-delete-${workflow.id}`}
                        size="sm"
                        variant="outline"
                        className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                        onClick={() => onDelete(workflow)}
                        aria-label={`Delete ${workflow.name}`}
                        title="Delete this user template"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Q19 — Template fork / remix modal.
// ---------------------------------------------------------------------------

interface TemplateForkModalProps {
  /** The template being forked. `null` keeps the modal closed. */
  original: WorkflowTemplate | null;
  onClose: () => void;
  onSaved: () => void;
}

function TemplateForkModal({ original, onClose, onSaved }: TemplateForkModalProps) {
  const [name, setName] = useState('');
  const [systemPrompt, setSystemPromptValue] = useState('');

  // Re-seed the fields whenever a new template opens the dialog.
  useEffect(() => {
    if (!original) return;
    setName(`${original.name} (custom)`);
    setSystemPromptValue(getSystemPrompt(original));
  }, [original]);

  const handleSave = useCallback(() => {
    if (!original) return;
    const duplicated = duplicateTemplate(original, { name: name.trim() || original.name });
    const withPrompt = setSystemPrompt(duplicated, systemPrompt);
    saveUserTemplate(withPrompt);
    onSaved();
  }, [original, name, systemPrompt, onSaved]);

  return (
    <Dialog
      open={original !== null}
      onOpenChange={(o) => { if (!o) onClose(); }}
    >
      <DialogContent
        data-testid="template-fork-modal"
        className="max-w-2xl w-[90vw]"
      >
        <DialogHeader>
          <DialogTitle>Duplicate template</DialogTitle>
          <DialogDescription>
            Create your own copy of this template. You can edit the system
            prompt that steers the AI while the workflow runs.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium block mb-1" htmlFor="template-fork-name">
              Name
            </label>
            <Input
              id="template-fork-name"
              data-testid="template-fork-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My custom template"
              className="h-9 text-sm"
            />
          </div>
          <div>
            <label
              className="text-xs font-medium block mb-1"
              htmlFor="template-fork-system-prompt"
            >
              System prompt
            </label>
            <textarea
              id="template-fork-system-prompt"
              data-testid="template-fork-system-prompt"
              value={systemPrompt}
              onChange={(e) => setSystemPromptValue(e.target.value)}
              rows={8}
              className="w-full min-h-[180px] rounded-md border border-input bg-background px-3 py-2 text-sm font-mono leading-relaxed resize-y focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              placeholder="You are an experienced..."
            />
            <p className="text-[11px] text-muted-foreground mt-1">
              This is the persona the AI uses in the first generation step.
              Leave it blank to fall back to the model's default persona.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            data-testid="template-fork-save"
            size="sm"
            onClick={handleSave}
            disabled={!original || name.trim().length === 0}
          >
            Save template
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Stream C1 — Grouped workflow list with collapsible provenance sections.
//
// Order: Built-in -> Community -> Custom. Each section renders only when it
// has at least one entry. Sections are collapsible with their open/closed
// state held locally (no persistence in v2.0; revisit if users ask).
//
// Each card preserves the existing `workflow-card-<id>` testid used by the
// e2e suite + adds a `workflow-card-provenance-<id>` badge when the template
// did not come from the built-in catalog. Built-ins are unbadged so the
// 12-card sidebar doesn't suddenly carry redundant chrome for every entry.
// ---------------------------------------------------------------------------

interface GroupedWorkflowListProps {
  workflows: WorkflowTemplate[];
  currentExecution: WorkflowExecution | null;
  trialLocked: boolean;
  onStart: (template: WorkflowTemplate) => void;
  onDuplicate: (template: WorkflowTemplate) => void;
  onDelete: (template: WorkflowTemplate) => void;
}

const PROVENANCE_ORDER: TemplateProvenance[] = ['built-in', 'community', 'custom'];

function resolveProvenance(t: WorkflowTemplate): TemplateProvenance {
  if (t.provenance) return t.provenance;
  if (t.isUser) return 'custom';
  return 'built-in';
}

function GroupedWorkflowList({
  workflows,
  currentExecution,
  trialLocked,
  onStart,
  onDuplicate,
  onDelete,
}: GroupedWorkflowListProps) {
  const [collapsed, setCollapsed] = useState<Record<TemplateProvenance, boolean>>({
    'built-in': false,
    community: false,
    custom: false,
  });

  const grouped = useMemo(() => {
    const buckets: Record<TemplateProvenance, WorkflowTemplate[]> = {
      'built-in': [],
      community: [],
      custom: [],
    };
    for (const t of workflows) {
      buckets[resolveProvenance(t)].push(t);
    }
    return buckets;
  }, [workflows]);

  return (
    <div data-testid="workflows-grouped-list" className="space-y-4">
      {PROVENANCE_ORDER.map((p) => {
        const list = grouped[p];
        if (list.length === 0) return null;
        const isCollapsed = collapsed[p];
        return (
          <section
            key={p}
            data-testid={`workflows-group-${p}`}
            data-provenance={p}
            className="space-y-2"
          >
            <button
              type="button"
              data-testid={`workflows-group-toggle-${p}`}
              onClick={() =>
                setCollapsed((prev) => ({ ...prev, [p]: !prev[p] }))
              }
              className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground w-full text-left"
              aria-expanded={!isCollapsed}
            >
              {isCollapsed ? (
                <ChevronRight className="h-3 w-3" aria-hidden="true" />
              ) : (
                <ChevronDown className="h-3 w-3" aria-hidden="true" />
              )}
              <span>{TEMPLATE_PROVENANCE_LABELS[p]}</span>
              <span className="text-muted-foreground/70 tabular-nums">
                ({list.length.toString()})
              </span>
            </button>

            {!isCollapsed && (
              <div className="space-y-2">
                {list.map((workflow) => {
                  const provenance = resolveProvenance(workflow);
                  return (
                    <Card
                      key={workflow.id}
                      data-testid={`workflow-card-${workflow.id}`}
                      data-provenance={provenance}
                      className="cursor-pointer hover:bg-muted/50 transition-colors"
                    >
                      <CardHeader className="p-3">
                        <div className="flex items-center justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <CardTitle
                              className="text-sm leading-snug line-clamp-2 break-words"
                              title={workflow.name}
                            >
                              {workflow.name}
                            </CardTitle>
                            <CardDescription
                              className="text-xs mt-1 line-clamp-2"
                              title={workflow.description}
                            >
                              {workflow.description}
                            </CardDescription>
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            <ProvenanceCardBadge
                              provenance={provenance}
                              templateId={workflow.id}
                            />
                            {workflow.isUser && (
                              <span
                                data-testid={`workflow-user-badge-${workflow.id}`}
                                className="text-[10px] font-medium uppercase tracking-wide bg-primary/10 text-primary px-1.5 py-0.5 rounded"
                              >
                                Custom
                              </span>
                            )}
                            <Button
                              data-testid={`template-picker-duplicate-${workflow.id}`}
                              size="sm"
                              variant="ghost"
                              className="h-7 w-7 p-0"
                              onClick={(e) => {
                                e.stopPropagation();
                                onDuplicate(workflow);
                              }}
                              aria-label={`Duplicate workflow: ${workflow.name}`}
                              title="Duplicate this template"
                            >
                              <Copy className="h-3.5 w-3.5" />
                            </Button>
                            {workflow.isUser && (
                              <Button
                                data-testid={`template-picker-delete-${workflow.id}`}
                                size="sm"
                                variant="ghost"
                                className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onDelete(workflow);
                                }}
                                aria-label={`Delete workflow: ${workflow.name}`}
                                title="Delete this user template"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            )}
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 w-7 p-0"
                              onClick={() => onStart(workflow)}
                              disabled={
                                currentExecution !== null || trialLocked
                              }
                              aria-label={`Start workflow: ${workflow.name}`}
                              title={
                                trialLocked
                                  ? `Trial ended, activate a license to run workflows`
                                  : `Start workflow: ${workflow.name}`
                              }
                            >
                              {currentExecution?.template.id === workflow.id ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <Play className="h-4 w-4" />
                              )}
                            </Button>
                          </div>
                        </div>
                      </CardHeader>
                    </Card>
                  );
                })}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

/**
 * Provenance badge for the per-card display. Built-ins render no badge
 * (the section header already labels the group + the built-in case is the
 * default). Community + custom render a compact pill.
 */
function ProvenanceCardBadge({
  provenance,
  templateId,
}: {
  provenance: TemplateProvenance;
  templateId: string;
}) {
  if (provenance === 'built-in') return null;
  const tone =
    provenance === 'community'
      ? 'bg-primary/10 text-primary'
      : 'bg-muted text-foreground';
  return (
    <span
      data-testid={`workflow-card-provenance-${templateId}`}
      data-provenance={provenance}
      className={`text-[10px] font-medium uppercase tracking-wide px-1.5 py-0.5 rounded ${tone}`}
    >
      {TEMPLATE_PROVENANCE_LABELS[provenance]}
    </span>
  );
}

function formatRelativeTime(isoString: string): string {
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffMins < 1440) return `${Math.floor(diffMins / 60)}h ago`;
  return `${Math.floor(diffMins / 1440)}d ago`;
}

export default WorkflowPanel;
