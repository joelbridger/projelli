// Workflow Execution Tab Component
// Renders an active workflow execution inside a main-panel tab, showing
// step progress, the current interview form, completed answers, generated
// output, and final export actions.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { InterviewForm } from './InterviewForm';
import {
  CheckCircle,
  Clock,
  Download,
  FileText,
  FileType,
  Link as LinkIcon,
  Loader2,
  XCircle,
  Zap,
} from 'lucide-react';
import type {
  WorkflowTemplate,
  WorkflowExecution,
  InterviewQuestion,
} from '@/types/workflow';
import { loadAllTemplates } from '@/modules/workflow/userTemplates';
import { cn } from '@/lib/utils';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import type { FileNode } from '@/types/workspace';

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
  className,
}: WorkflowExecutionTabProps) {
  const bottomRef = useRef<HTMLDivElement | null>(null);

  // Completed step answers for display
  const [completedAnswers, setCompletedAnswers] = useState<
    { stepName: string; answers: Record<string, string> }[]
  >([]);

  // Track completed steps to accumulate answers
  const prevStepIndex = useRef(-1);
  useEffect(() => {
    if (!execution) return;
    if (execution.currentStepIndex > prevStepIndex.current && execution.currentStepIndex > 0) {
      // A step just finished — collect its output if it was an interview.
      const finishedIndex = execution.currentStepIndex - 1;
      const finishedStep = template.steps[finishedIndex];
      if (finishedStep?.type === 'interview') {
        const answersKey = `${finishedStep.id}_answers`;
        const answers = execution.inputs[answersKey] as Record<string, string> | undefined;
        if (answers) {
          setCompletedAnswers((prev) => [
            ...prev,
            { stepName: finishedStep.name, answers },
          ]);
        }
      }
    }
    prevStepIndex.current = execution.currentStepIndex;
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
  const progressPercent = isCompleted
    ? 100
    : totalSteps > 0
      ? Math.round((currentStep / totalSteps) * 100)
      : 0;

  return (
    <div
      data-testid="workflow-execution-tab"
      className={cn('flex flex-col h-full', className)}
    >
      {/* Header */}
      <div className="shrink-0 border-b bg-muted/30 px-6 py-4">
        <div className="flex items-center gap-3">
          <Zap className="h-5 w-5 text-amber-500" />
          <div className="flex-1 min-w-0">
            <h2 className="text-base font-semibold truncate">{template.name}</h2>
            <p className="text-xs text-muted-foreground truncate">
              {template.description}
            </p>
          </div>
          {isRunning && (
            <Button
              variant="outline"
              size="sm"
              className="shrink-0 text-xs"
              onClick={onCancel}
            >
              Cancel
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
          <span className="text-xs text-muted-foreground shrink-0">
            {isCompleted
              ? 'Complete'
              : isFailed
                ? 'Failed'
                : `Step ${currentStep + 1} of ${totalSteps}`}
          </span>
        </div>
      </div>

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
        {/* Step list */}
        <div className="space-y-1">
          {template.steps.map((step, index) => {
            const isDone = execution ? index < execution.currentStepIndex : false;
            const isCurrent = execution ? index === execution.currentStepIndex : false;
            const isPending = !isDone && !isCurrent;

            return (
              <div
                key={step.id}
                className={cn(
                  'flex items-center gap-2 px-3 py-1.5 rounded text-sm',
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
                <span>{step.name}</span>
                {step.description && (
                  <span className="text-xs text-muted-foreground ml-auto truncate max-w-[40%]">
                    {step.description}
                  </span>
                )}
              </div>
            );
          })}
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

        {/* Current interview form */}
        {interviewQuestions && isRunning && (
          <Card className="border-amber-500/30">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Loader2 className="h-4 w-4 text-amber-500 animate-spin" />
                {template.steps[currentStep]?.name ?? 'Questions'}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <InterviewForm
                questions={interviewQuestions}
                onSubmit={handleInterviewSubmit}
                onCancel={onCancel}
              />
            </CardContent>
          </Card>
        )}

        {/* AI generation in progress (no interview, still running) */}
        {!interviewQuestions && isRunning && (
          <Card>
            <CardContent className="py-8 flex flex-col items-center gap-3 text-muted-foreground">
              <Loader2 className="h-8 w-8 animate-spin text-amber-500" />
              <p className="text-sm font-medium">
                Generating{template.steps[currentStep]?.name ? `: ${template.steps[currentStep]!.name}` : '...'}
              </p>
              <p className="text-xs">This may take a moment depending on the AI provider.</p>
            </CardContent>
          </Card>
        )}

        {/* Error state */}
        {isFailed && execution?.error && (
          <Card className="border-red-500/30">
            <CardContent className="py-4">
              <div className="flex items-start gap-2">
                <XCircle className="h-5 w-5 text-red-500 shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-red-600">Workflow failed</p>
                  <p className="text-xs text-muted-foreground mt-1">{execution.error}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Final output */}
        {isCompleted && finalOutput && (
          <Card className="border-green-500/30">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <CheckCircle className="h-4 w-4 text-green-500" />
                Generated Output
              </CardTitle>
            </CardHeader>
            <CardContent>
              <pre className="text-xs whitespace-pre-wrap bg-muted/50 rounded p-3 max-h-[400px] overflow-y-auto">
                {finalOutput}
              </pre>
              <div className="flex items-center gap-2 mt-4">
                {onSaveAsFile && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      onSaveAsFile(finalOutput, `${template.name.replace(/\s+/g, '-')}.md`)
                    }
                  >
                    <Download className="h-3.5 w-3.5 mr-1.5" />
                    Save as file
                  </Button>
                )}
                {onExportDocx && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      onExportDocx(finalOutput, `${template.name.replace(/\s+/g, '-')}.docx`)
                    }
                  >
                    <FileType className="h-3.5 w-3.5 mr-1.5 text-blue-600" />
                    Export .docx
                  </Button>
                )}
                {onExportPptx && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      onExportPptx(finalOutput, `${template.name.replace(/\s+/g, '-')}.pptx`)
                    }
                  >
                    <FileType className="h-3.5 w-3.5 mr-1.5 text-orange-600" />
                    Export .pptx
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
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
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <FileText className="h-4 w-4 text-blue-500" />
                Created Files ({fileLinks.length})
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
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <LinkIcon className="h-4 w-4 text-amber-500" />
          Use this as input for another template
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {recommended.length > 0 && (
          <div>
            <p className="text-xs text-muted-foreground mb-1.5">Recommended next steps</p>
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
                  {t.name} →
                </Button>
              ))}
            </div>
          </div>
        )}
        {others.length > 0 && (
          <details className="text-xs">
            <summary className="cursor-pointer text-muted-foreground">
              Other templates (manual mapping required)
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
