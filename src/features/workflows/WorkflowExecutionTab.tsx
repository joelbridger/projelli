// Workflow Execution Tab Component
// Renders an active workflow execution inside a main-panel tab, showing
// step progress, the current interview form, completed answers, generated
// output, and final export actions.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/ui/dropdown-menu';
import { Input } from '@/ui/input';
import { Label } from '@/ui/label';
import { InterviewForm } from './InterviewForm';
import {
  AlertCircle,
  CheckCircle,
  Clock,
  Download,
  FileText,
  FileType,
  HelpCircle,
  Link as LinkIcon,
  Loader2,
  MoreHorizontal,
  Settings,
  XCircle,
  Zap,
} from 'lucide-react';
import type {
  WorkflowTemplate,
  WorkflowExecution,
  InterviewQuestion,
} from '@/platform/types/workflow';
import { loadAllTemplates } from '@/features/workflows/engine/userTemplates';
import { cn } from '@/lib/utils';
import { useWorkspaceStore } from '@/platform/fs/workspaceStore';
import type { FileNode } from '@/platform/types/workspace';
import { useEntityLabelEnglish } from '@/platform/hooks/useEntityLabel';
import { SK_FIRM_NAME } from '@/config/identity';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WorkflowExecutionTabProps {
  /** The template being executed. */
  template: WorkflowTemplate;
  /** Live execution state (null before engine starts). */
  execution: WorkflowExecution | null;
  /** Current interview questions (null when not in an interview step). */
  interviewQuestions: InterviewQuestion[] | null;
  /** Called when the user submits interview answers. */
  onInterviewSubmit: (answers: Record<string, string>) => void;
  /** Called when the user cancels the workflow. */
  onCancel: () => void;
  /** Called to save the final output as a file. */
  onSaveAsFile?: (content: string, suggestedName: string) => void;
  /** Called to export the final output as .docx. */
  onExportDocx?: (content: string, suggestedName: string) => void;
  /** Called to export the final output as .pptx. */
  onExportPptx?: (content: string, suggestedName: string) => void;
  /** Called to open a file in a new tab. */
  onFileOpen?: (path: string, name: string) => void;
  /**
   * M7 — user clicked "Use as input for another template →" on the chain
   * suggestion callout. Parent typically opens the ChainBuilderModal with
   * this run's template pre-filled as step 0.
   */
  onStartChainFromHere?: (
    sourceTemplate: WorkflowTemplate,
    targetTemplate: WorkflowTemplate
  ) => void;
  /**
   * F-106/F-107 — when set, the run was blocked before it started because no
   * usable AI provider is available. One of:
   *   'needs-client' — no active client; user must pick a client before the
   *                    workflow can run.
   *   'needs-provider' — no cloud key AND no reachable local model; user must
   *                      configure a provider before the workflow can run.
   *   'ollama-unreachable' — the template is pinned to Ollama, but Ollama is
   *                          not running. The workflow will NEVER fall back to
   *                          a cloud key; start Ollama or change the template's
   *                          model setting.
   * When this prop is set the tab renders a blocking UI instead of execution
   * state. It is mutually exclusive with a running execution.
   */
  providerError?: 'needs-provider' | 'ollama-unreachable' | 'needs-client';
  /** Optional callback to open Settings (used by the provider-error UI). */
  onOpenSettings?: () => void;
  className?: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Recursively flatten a FileNode tree into an array of absolute paths.
 */
function flattenPaths(nodes: FileNode[]): string[] {
  const result: string[] = [];
  for (const node of nodes) {
    result.push(node.path);
    if (node.children) {
      result.push(...flattenPaths(node.children));
    }
  }
  return result;
}

/**
 * Scan text for workspace-relative file paths by matching against the
 * current file tree. Returns deduplicated {path, name} pairs.
 */
function extractFileLinks(
  text: string,
  allPaths: string[],
  rootPath: string | null
): { path: string; name: string }[] {
  if (!rootPath || !text || allPaths.length === 0) return [];

  const seen = new Set<string>();
  const results: { path: string; name: string }[] = [];

  for (const fullPath of allPaths) {
    // Derive a relative path from rootPath for matching in the text
    const rel = fullPath.startsWith(rootPath + '/')
      ? fullPath.slice(rootPath.length + 1)
      : null;

    // Check if the full path or relative path appears in the text
    const name = fullPath.split('/').pop() ?? fullPath;

    if (rel && text.includes(rel) && !seen.has(fullPath)) {
      seen.add(fullPath);
      results.push({ path: fullPath, name });
    } else if (text.includes(name) && !seen.has(fullPath) && name.includes('.')) {
      // Match by filename alone (only if it has an extension to avoid false positives)
      seen.add(fullPath);
      results.push({ path: fullPath, name });
    }
  }

  return results;
}

export function WorkflowExecutionTab({
  template,
  execution,
  interviewQuestions,
  onInterviewSubmit,
  onCancel,
  onSaveAsFile,
  onExportDocx,
  onExportPptx,
  onFileOpen,
  onStartChainFromHere,
  providerError,
  onOpenSettings,
  className,
}: WorkflowExecutionTabProps) {
  const { t } = useTranslation();
  // Fixed-English escape hatch: both sentences using entityLabel below are
  // still hardcoded English (see the cleanup2 handoff), so the noun stays
  // English too rather than mixing languages.
  const entityLabel = useEntityLabelEnglish();
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const [showAllSteps, setShowAllSteps] = useState(false);
  const [docxExportOpen, setDocxExportOpen] = useState(false);

  // Firm name persisted in localStorage — used to brand exported .docx files
  const [firmName, setFirmName] = useState<string>(() => {
    try {
      return localStorage.getItem(SK_FIRM_NAME) ?? '';
    } catch {
      return '';
    }
  });

  const handleFirmNameChange = useCallback((value: string) => {
    setFirmName(value);
    try {
      localStorage.setItem(SK_FIRM_NAME, value);
    } catch {
      // localStorage may be unavailable (private browsing, quota exceeded)
    }
  }, []);

  // Derive completed step answers directly from execution state.
  // This is a pure computation from existing state — no separate useState/useEffect needed.
  const completedAnswers = useMemo(() => {
    if (!execution) return [];
    const result: { stepName: string; answers: Record<string, string> }[] = [];
    for (let i = 0; i < execution.currentStepIndex; i++) {
      const step = template.steps[i];
      if (step?.type === 'interview') {
        const answersKey = `${step.id}_answers`;
        const answers = execution.inputs[answersKey] as Record<string, string> | undefined;
        if (answers) {
          result.push({ stepName: step.name, answers });
        }
      }
    }
    return result;
  }, [execution, template.steps]);

  // Auto-scroll to bottom when content changes
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [execution?.currentStepIndex, interviewQuestions, completedAnswers.length]);

  // Derive final output from the last generate step
  const finalOutput = (() => {
    if (!execution || execution.status !== 'completed') return null;
    // Walk backwards through steps to find the last generate step output
    for (let i = template.steps.length - 1; i >= 0; i--) {
      const step = template.steps[i];
      if (step?.type === 'generate' || step?.type === 'review') {
        const key = step.type === 'generate' ? `${step.id}_output` : `${step.id}_review`;
        const content = execution.inputs[key] as string | undefined;
        if (content) return content;
      }
    }
    return null;
  })();

  // WS-D — an `analyze` step produces a structured Word deliverable + verified/
  // unverified counts rather than markdown. Surface a summary that makes the
  // "flagged for you to verify" framing explicit and points at the .docx (which
  // shows up in the file-links section below). Walk backwards for the last one.
  const analyzeSummary = (() => {
    if (!execution || execution.status !== 'completed') return null;
    for (let i = template.steps.length - 1; i >= 0; i--) {
      const step = template.steps[i];
      if (step?.type === 'analyze') {
        const summary = execution.inputs[`${step.id}_summary`] as
          | { total: number; verified: number; unverified: number }
          | undefined;
        const file = execution.inputs[`${step.id}_file`] as string | undefined;
        if (summary) return { summary, file };
      }
    }
    return null;
  })();

  const handleInterviewSubmit = useCallback(
    (answers: Record<string, string>) => {
      onInterviewSubmit(answers);
    },
    [onInterviewSubmit]
  );

  // --- Live file links ---
  // Watch the workspace file tree for files created during this workflow.
  // Scans all text in execution.inputs (step outputs) for recognizable
  // workspace paths/filenames and renders them as clickable links.
  const { fileTree, rootPath } = useWorkspaceStore();
  const allPaths = useMemo(() => flattenPaths(fileTree), [fileTree]);

  const workflowTextBlob = useMemo(() => {
    if (!execution) return '';
    // Combine all string values from execution.inputs
    const parts: string[] = [];
    for (const v of Object.values(execution.inputs)) {
      if (typeof v === 'string') parts.push(v);
    }
    if (finalOutput) parts.push(finalOutput);
    return parts.join('\n');
  }, [execution, finalOutput]);

  const fileLinks = useMemo(
    () => extractFileLinks(workflowTextBlob, allPaths, rootPath),
    [workflowTextBlob, allPaths, rootPath]
  );

  const isRunning = execution?.status === 'running';
  const isCompleted = execution?.status === 'completed';
  const isFailed = execution?.status === 'failed';
  const totalSteps = template.steps.length;
  const currentStep = execution?.currentStepIndex ?? 0;
  const currentStepNumber = totalSteps > 0 ? Math.min(currentStep + 1, totalSteps) : 0;
  const currentStepLabel = totalSteps > 0
    ? t('workflow.execution.step-short', { current: currentStepNumber, total: totalSteps })
    : t('workflow.execution.no-steps');
  const progressPercent = isCompleted
    ? 100
    : totalSteps > 0
      ? Math.round((currentStep / totalSteps) * 100)
      : 0;
  const primaryFileLink = fileLinks[0] ?? null;
  const suggestedFileBase = template.name.replace(/\s+/g, '-');

  // F-106/F-107 — provider-error blocking state. Render this INSTEAD of the
  // normal execution UI when the run was refused before starting because no
  // usable AI provider is available. This surface is the only feedback the user
  // gets; never show a green "Complete" under this condition.
  if (providerError) {
    const isOllama = providerError === 'ollama-unreachable';
    const needsClient = providerError === 'needs-client';
    return (
      <div
        data-testid="workflow-provider-error"
        data-provider-error={providerError}
        className={cn('flex flex-col h-full overflow-x-hidden', className)}
      >
        {/* Header — same chrome as the normal tab so it still feels familiar */}
        <div className="shrink-0 border-b bg-background px-6 py-4">
          <div className="flex items-center gap-3">
            <Zap className="h-5 w-5 text-amber-500" />
            <div className="flex-1 min-w-0">
              <h2 className="text-base font-semibold truncate">{template.name}</h2>
            </div>
          </div>
        </div>

        {/* Blocking body */}
        <div className="flex-1 flex items-center justify-center px-6 py-12">
          <div className="max-w-sm w-full space-y-4 text-center">
            <div className="flex justify-center">
              <AlertCircle className="h-10 w-10 text-amber-500" />
            </div>
            <div>
              <p className="font-semibold text-base">
                {needsClient
                  ? t('workflow.execution.needs-client-title')
                  : isOllama
                  ? t('workflow.execution.ollama-unreachable-title')
                  : t('workflow.execution.needs-provider-title')}
              </p>
              <p className="text-sm text-muted-foreground mt-1">
                {needsClient
                  ? t('workflow.execution.needs-client-body')
                  : isOllama
                  ? t('workflow.execution.ollama-unreachable-body')
                  : t('workflow.execution.needs-provider-body')}
              </p>
            </div>
            {!isOllama && !needsClient && onOpenSettings && (
              <Button
                size="sm"
                onClick={onOpenSettings}
                className="gap-2"
              >
                <Settings className="h-4 w-4" />
                {t('workflow.execution.needs-provider-action')}
              </Button>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      data-testid="workflow-execution-tab"
      className={cn('flex flex-col h-full overflow-x-hidden', className)}
    >
      {/* Header */}
      <div className="sticky top-0 z-10 shrink-0 border-b bg-background px-6 py-3">
        <div className="flex items-center gap-3">
          <Zap className="h-5 w-5 text-amber-500" />
          <div className="flex-1 min-w-0">
            <h2 className="text-base font-semibold truncate">
              {template.name}
              <span className="text-muted-foreground font-normal"> · </span>
              <span className="text-muted-foreground font-medium">
                {isCompleted
                  ? t('workflow.execution.complete')
                  : isFailed
                    ? t('workflow.execution.failed')
                    : currentStepLabel}
              </span>
            </h2>
          </div>
          {isRunning && (
            <Button
              variant="outline"
              size="sm"
              className="shrink-0 text-xs"
              onClick={onCancel}
            >
              {t('workflow.execution.cancel')}
            </Button>
          )}
        </div>

        {/* Progress bar */}
        <div className="mt-3 flex items-center gap-3">
          <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
            <div
              className={cn(
                'h-full rounded-full transition-all duration-500',
                isCompleted ? 'bg-green-500' : isFailed ? 'bg-red-500' : 'bg-amber-500'
              )}
              style={{ width: `${progressPercent}%` }}
            />
          </div>
          <span
            data-testid="workflow-status-pill"
            className={cn(
              'inline-flex items-center gap-1.5 text-xs font-medium shrink-0',
              isCompleted && 'text-green-700',
              isFailed && 'text-red-700',
              isRunning && 'text-amber-700'
            )}
            style={{ pointerEvents: 'none' }}
          >
            {isRunning && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {isCompleted
              ? t('workflow.execution.complete')
              : isFailed
                ? t('workflow.execution.failed')
                : currentStepLabel}
          </span>
        </div>
      </div>

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
        {/* Step list */}
        <div className="space-y-2">
          {template.steps[currentStep] && (
            <div
              data-testid="workflow-current-step"
              className="flex items-center gap-2 rounded-md bg-amber-50 px-3 py-2 text-sm font-medium text-amber-900"
            >
              {isRunning ? (
                <Loader2 className="h-4 w-4 text-amber-500 animate-spin shrink-0" />
              ) : isFailed ? (
                <XCircle className="h-4 w-4 text-red-500 shrink-0" />
              ) : (
                <Clock className="h-4 w-4 text-muted-foreground/70 shrink-0" />
              )}
              <span className="truncate min-w-0">{template.steps[currentStep]?.name}</span>
            </div>
          )}
          {template.steps.length > 1 && (
            <button
              type="button"
              data-testid="workflow-show-all-steps"
              className="text-xs font-medium text-muted-foreground hover:text-foreground"
              onClick={() => setShowAllSteps((value) => !value)}
            >
              {showAllSteps ? t('workflow.execution.hide-all-steps') : t('workflow.execution.show-all-steps')}
            </button>
          )}
          {showAllSteps && (
            <div data-testid="workflow-all-steps" className="space-y-1">
              {template.steps.map((step, index) => {
                const isDone = execution ? index < execution.currentStepIndex : false;
                const isCurrent = execution ? index === execution.currentStepIndex : false;
                const isPending = !isDone && !isCurrent;

                return (
                  <div
                    key={step.id}
                    className={cn(
                      'flex items-center gap-2 px-3 py-1.5 rounded text-sm min-w-0',
                      isCurrent && 'bg-amber-500/10 font-medium',
                      isDone && 'text-muted-foreground'
                    )}
                  >
                    {isDone && <CheckCircle className="h-4 w-4 text-green-500 shrink-0" />}
                    {isCurrent && isRunning && (
                      <Loader2 className="h-4 w-4 text-amber-500 animate-spin shrink-0" />
                    )}
                    {isCurrent && isFailed && (
                      <XCircle className="h-4 w-4 text-red-500 shrink-0" />
                    )}
                    {isPending && <Clock className="h-4 w-4 text-muted-foreground/50 shrink-0" />}
                    <span className="truncate min-w-0">{step.name}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Completed interview answers */}
        {completedAnswers.map((entry, i) => (
          <Card key={i} className="border-green-500/20">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <CheckCircle className="h-4 w-4 text-green-500" />
                {entry.stepName}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-1">
              {Object.entries(entry.answers).map(([key, value]) => (
                <div key={key} className="text-xs">
                  <span className="font-medium text-muted-foreground">{key}:</span>{' '}
                  <span className="text-foreground">{value}</span>
                </div>
              ))}
            </CardContent>
          </Card>
        ))}

        {/* Current interview form — waiting for user input, NOT generating */}
        {interviewQuestions && isRunning && (
          <div
            data-testid="workflow-current-input"
            className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3"
          >
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-amber-900">
                <HelpCircle className="h-4 w-4 text-amber-500" />
                {t('workflow.execution.waiting-for-answers')}
            </div>
            <InterviewForm
              questions={interviewQuestions}
              onSubmit={handleInterviewSubmit}
              onCancel={onCancel}
            />
          </div>
        )}

        {/* AI generation in progress (no interview, still running) */}
        {!interviewQuestions && isRunning && (
          <div className="rounded-md border border-border py-8 flex flex-col items-center gap-3 text-muted-foreground">
              <Loader2 className="h-8 w-8 animate-spin text-amber-500" />
              <p className="text-sm font-medium">
                {template.steps[currentStep]?.name
                  ? t('workflow.execution.generating-step', { step: template.steps[currentStep]?.name })
                  : t('workflow.execution.generating')}
              </p>
              <p className="text-xs">{t('workflow.execution.may-take-moment')}</p>
          </div>
        )}

        {/* Error state */}
        {isFailed && execution?.error && (
          <Card className="border-red-500/30">
            <CardContent className="py-4">
              <div className="flex items-start gap-2">
                <XCircle className="h-5 w-5 text-red-500 shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-red-600">{t('workflow.execution.workflow-failed')}</p>
                  <p className="text-xs text-muted-foreground mt-1">{execution.error}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* G — Verification banner for research templates */}
        {isCompleted && template.requiresVerification && (
          <div
            data-testid="workflow-verification-banner"
            role="alert"
            className="rounded-md border border-amber-400 bg-amber-50 px-4 py-3 text-sm text-amber-900"
          >
            <span className="font-semibold">Verify before relying.</span>{' '}
            {template.verificationNote ?? `This output was produced by AI. Check citations, math, and regulatory positions against primary sources before use in your clients' ${entityLabel.other}.`}
          </div>
        )}

        {/* WS-D — Structured analyze deliverable summary (e.g. contradiction finder). */}
        {isCompleted && analyzeSummary && (
          <Card className="border-green-500/30" data-testid="workflow-analyze-summary">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <FileType className="h-4 w-4 text-blue-600" />
                Word deliverable ready
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm space-y-2">
              <p>
                Flagged <span className="font-semibold">{analyzeSummary.summary.total}</span>{' '}
                {analyzeSummary.summary.total === 1 ? 'candidate finding' : 'candidate findings'} for your
                review.{' '}
                <span className="font-semibold text-green-700">{analyzeSummary.summary.verified} verified</span>{' '}
                against the {entityLabel.one} record;{' '}
                <span className="font-semibold text-amber-700">
                  {analyzeSummary.summary.unverified} flagged unverified
                </span>
                .
              </p>
              {analyzeSummary.file && (
                <p className="text-xs text-muted-foreground">
                  Open <span className="font-medium">{analyzeSummary.file}</span> below to review the findings
                  table in the Word editor. Every finding carries a citation. Verify each against the original
                  before relying on it.
                </p>
              )}
            </CardContent>
          </Card>
        )}

        {/* Final output */}
        {isCompleted && finalOutput && (
          <>
          <Card className="border-green-500/30" data-testid="workflow-final-output">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <CheckCircle className="h-4 w-4 text-green-500" />
                {t('workflow.execution.draft-ready')}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center gap-2">
                {primaryFileLink && (
                  <Button
                    data-testid="workflow-open-draft"
                    size="sm"
                    onClick={() => onFileOpen?.(primaryFileLink.path, primaryFileLink.name)}
                  >
                    <FileText className="h-3.5 w-3.5 mr-1.5" />
                    {t('workflow.execution.open')}
                  </Button>
                )}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      data-testid="workflow-output-menu"
                      size="sm"
                      variant="outline"
                      aria-label={t('workflow.execution.more-actions')}
                    >
                      <MoreHorizontal className="h-3.5 w-3.5" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    {onSaveAsFile && (
                      <DropdownMenuItem
                        data-testid="workflow-save-output"
                        onSelect={() => onSaveAsFile(finalOutput, `${suggestedFileBase}.md`)}
                      >
                        <Download className="h-3.5 w-3.5 mr-2" />
                        {t('workflow.execution.save-as-file')}
                      </DropdownMenuItem>
                    )}
                    {onExportDocx && (
                      <DropdownMenuItem
                        data-testid="workflow-export-docx-trigger"
                        onSelect={() => setDocxExportOpen(true)}
                      >
                        <FileType className="h-3.5 w-3.5 mr-2 text-blue-600" />
                        {t('workflow.execution.export-docx')}
                      </DropdownMenuItem>
                    )}
                    {onExportPptx && (
                      <DropdownMenuItem
                        data-testid="workflow-export-pptx"
                        onSelect={() => onExportPptx(finalOutput, `${suggestedFileBase}.pptx`)}
                      >
                        <FileType className="h-3.5 w-3.5 mr-2 text-orange-600" />
                        {t('workflow.execution.export-pptx')}
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              <details data-testid="workflow-output-preview" className="text-xs">
                <summary className="cursor-pointer font-medium text-muted-foreground">
                  {t('workflow.execution.preview-text')}
                </summary>
                <pre className="mt-2 whitespace-pre-wrap break-words bg-muted/50 rounded p-3 max-h-[400px] overflow-y-auto overflow-x-hidden">
                  {finalOutput}
                </pre>
              </details>
            </CardContent>
          </Card>
          {onExportDocx && (
            <Dialog open={docxExportOpen} onOpenChange={setDocxExportOpen}>
              <DialogContent data-testid="workflow-docx-export-dialog" className="max-w-sm">
                <DialogHeader>
                  <DialogTitle>{t('workflow.execution.export-docx')}</DialogTitle>
                  <DialogDescription>
                    {t('workflow.execution.export-docx-description')}
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-2">
                  <Label htmlFor="firm-name-input" className="text-sm">
                    {t('workflow.execution.firm-name')}
                  </Label>
                  <Input
                    id="firm-name-input"
                    data-testid="workflow-firm-name-input"
                    value={firmName}
                    onChange={(e) => handleFirmNameChange(e.target.value)}
                    placeholder={t('workflow.execution.firm-name-placeholder')}
                    className="h-9 text-sm"
                  />
                </div>
                <DialogFooter>
                  <Button variant="outline" size="sm" onClick={() => setDocxExportOpen(false)}>
                    {t('workflow.execution.cancel')}
                  </Button>
                  <Button
                    data-testid="workflow-export-docx-confirm"
                    size="sm"
                    onClick={() => {
                      onExportDocx(finalOutput, `${suggestedFileBase}.docx`);
                      setDocxExportOpen(false);
                    }}
                  >
                    {t('workflow.execution.export')}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          )}
          </>
        )}

        {/* M7 — Chain suggestions: templates that can consume this run's outputs */}
        {isCompleted && (template.namedOutputs?.length ?? 0) > 0 && (
          <ChainSuggestions
            sourceTemplate={template}
            onPick={(target) => onStartChainFromHere?.(template, target)}
          />
        )}

        {/* Live file links — files created during this workflow */}
        {fileLinks.length > 0 && (
          <Card data-testid="workflow-created-files">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <FileText className="h-4 w-4 text-blue-500" />
                {t('workflow.execution.created-file')}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-1">
              {fileLinks.map((link) => (
                <button
                  key={link.path}
                  data-testid={`workflow-file-link-${link.name}`}
                  className="flex items-center gap-2 w-full text-left text-sm px-2 py-1.5 rounded hover:bg-muted/50 transition-colors text-primary underline-offset-2 hover:underline"
                  onClick={() => onFileOpen?.(link.path, link.name)}
                >
                  <FileText className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{link.name}</span>
                </button>
              ))}
            </CardContent>
          </Card>
        )}

        <div ref={bottomRef} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// M7 — Chain suggestions. Rendered after a completed run with named outputs.
// Highlights templates that can consume those outputs; dims the rest.
// ---------------------------------------------------------------------------

interface ChainSuggestionsProps {
  sourceTemplate: WorkflowTemplate;
  onPick: (target: WorkflowTemplate) => void;
}

function ChainSuggestions({ sourceTemplate, onPick }: ChainSuggestionsProps) {
  const { t } = useTranslation();
  const [pickerOpen, setPickerOpen] = useState(false);
  const allTemplates = useMemo(() => loadAllTemplates(), []);
  const sourceOutputIds = useMemo(
    () => (sourceTemplate.namedOutputs ?? []).map((o) => o.id),
    [sourceTemplate]
  );

  const { recommended, others } = useMemo(() => {
    const recommended: WorkflowTemplate[] = [];
    const others: WorkflowTemplate[] = [];
    for (const t of allTemplates) {
      if (t.id === sourceTemplate.id) continue;
      const inputs = t.namedInputs ?? [];
      const fits = inputs.some((inp) =>
        (inp.acceptsOutputFrom ?? []).some((id) => sourceOutputIds.includes(id))
      );
      if (fits) recommended.push(t);
      else others.push(t);
    }
    return { recommended, others };
  }, [allTemplates, sourceOutputIds, sourceTemplate.id]);

  return (
    <Card data-testid="chain-suggestions" className="border-amber-500/30">
      <CardContent className="space-y-3 pt-4">
        <Button
          data-testid="chain-suggestions-open"
          size="sm"
          variant="outline"
          className="gap-2"
          onClick={() => setPickerOpen((value) => !value)}
        >
          <LinkIcon className="h-4 w-4 text-amber-500" />
          {t('workflow.execution.use-as-input')}
        </Button>
        {pickerOpen && recommended.length > 0 && (
          <div>
            <p className="text-xs text-muted-foreground mb-1.5">{t('workflow.execution.recommended-next')}</p>
            <div className="flex flex-wrap gap-1.5">
              {recommended.map((t) => (
                <Button
                  key={t.id}
                  data-testid={`chain-suggest-${t.id}`}
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs"
                  onClick={() => onPick(t)}
                  title={t.description}
                >
                  {t.name}
                </Button>
              ))}
            </div>
          </div>
        )}
        {pickerOpen && others.length > 0 && (
          <details className="text-xs">
            <summary className="cursor-pointer text-muted-foreground">
              {t('workflow.execution.other-templates')}
            </summary>
            <div className="flex flex-wrap gap-1.5 mt-1.5 opacity-60">
              {others.slice(0, 12).map((t) => (
                <Button
                  key={t.id}
                  data-testid={`chain-suggest-other-${t.id}`}
                  size="sm"
                  variant="ghost"
                  className="h-6 text-[11px]"
                  onClick={() => onPick(t)}
                >
                  {t.name}
                </Button>
              ))}
            </div>
          </details>
        )}
      </CardContent>
    </Card>
  );
}

export default WorkflowExecutionTab;
