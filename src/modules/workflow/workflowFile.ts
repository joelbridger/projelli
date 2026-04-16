// Workflow file persistence helpers
//
// `.workflow` files are JSON snapshots of a workflow execution. They live
// inside the per-run workflow folder alongside any generated artifacts and
// give the user a stable, addressable file for past runs. Active runs write
// a debounced snapshot here so re-opening the tab restores the same state.
//
// All helpers are pure conversion + parsing utilities; the actual disk I/O
// is owned by App.tsx (which already holds the workspace service ref).

import type {
  InterviewQuestion,
  WorkflowExecution,
  WorkflowFileData,
  WorkflowTemplate,
} from '@/types/workflow';

const FILE_EXT = '.workflow';

/**
 * Slugify a workflow template name for use in a filename.
 *
 * Lowercases the input, replaces any non-alphanumeric character with `-`,
 * collapses runs of `-`, and trims leading/trailing dashes. Empty results
 * fall back to `'workflow'` so we never produce an empty filename root.
 */
export function slugifyTemplateName(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return slug || 'workflow';
}

/**
 * Format a timestamp as `YYYY-MM-DD-HHMM` in local time.
 *
 * Local time keeps filenames intuitive for the user — they typed "create a
 * workflow at 2pm" and they want to see `2-00pm` ish in the filename, not a
 * UTC offset.
 */
export function formatWorkflowTimestamp(date: Date): string {
  const pad = (n: number) => n.toString().padStart(2, '0');
  const yyyy = date.getFullYear();
  const mm = pad(date.getMonth() + 1);
  const dd = pad(date.getDate());
  const hh = pad(date.getHours());
  const min = pad(date.getMinutes());
  return `${yyyy}-${mm}-${dd}-${hh}${min}`;
}

/**
 * Build a `.workflow` filename for a given template + start time.
 *
 * Example: buildWorkflowFilename({name: 'Investor Update'}, new Date(2026, 3, 15, 14, 30))
 *          => 'investor-update-2026-04-15-1430.workflow'
 */
export function buildWorkflowFilename(
  template: Pick<WorkflowTemplate, 'name'>,
  startTime: Date
): string {
  const slug = slugifyTemplateName(template.name);
  const ts = formatWorkflowTimestamp(startTime);
  return `${slug}-${ts}${FILE_EXT}`;
}

/**
 * Build the persisted file shape from a live execution.
 *
 * Caller passes the execution + its companion metadata (workflow folder
 * path, completed answers, artifact list). We translate Date objects to
 * ISO strings and map status onto the file-data status enum. The file
 * status is narrower than WorkflowExecution.status: the file never holds
 * 'pending' or 'paused' (we only ever persist after a run starts), and
 * adds 'cancelled' for explicit cancel events.
 */
export function executionToFileData(opts: {
  execution: WorkflowExecution;
  workflowFolderPath: string;
  completedAnswers: { stepName: string; answers: Record<string, string> }[];
  artifacts: string[];
  status?: 'running' | 'completed' | 'failed' | 'cancelled';
}): WorkflowFileData {
  const { execution, workflowFolderPath, completedAnswers, artifacts } = opts;
  const status: WorkflowFileData['status'] =
    opts.status ??
    (execution.status === 'completed'
      ? 'completed'
      : execution.status === 'failed'
        ? 'failed'
        : 'running');

  const data: WorkflowFileData = {
    schemaVersion: 1,
    runId: execution.runId,
    template: execution.template,
    workflowFolderPath,
    currentStepIndex: execution.currentStepIndex,
    status,
    inputs: execution.inputs,
    stepOutputs: execution.stepOutputs,
    completedAnswers,
    startTime: execution.startTime.toISOString(),
    artifacts,
  };
  if (execution.endTime) {
    data.endTime = execution.endTime.toISOString();
  }
  if (execution.error) {
    data.error = execution.error;
  }
  return data;
}

/**
 * Re-hydrate a live WorkflowExecution from a persisted file snapshot.
 *
 * Used when the user opens a past `.workflow` file from the file tree and
 * we want WorkflowExecutionTab to render its progress + outputs. The
 * resulting execution has its status mapped back to the live enum:
 * file 'cancelled' becomes 'failed' on the live shape (close enough — the
 * tab UI shows the same XCircle either way).
 */
export function fileDataToExecution(data: WorkflowFileData): WorkflowExecution {
  const status: WorkflowExecution['status'] =
    data.status === 'completed'
      ? 'completed'
      : data.status === 'failed' || data.status === 'cancelled'
        ? 'failed'
        : 'running';

  const execution: WorkflowExecution = {
    runId: data.runId,
    template: data.template,
    currentStepIndex: data.currentStepIndex,
    status,
    inputs: data.inputs,
    stepOutputs: data.stepOutputs,
    startTime: new Date(data.startTime),
  };
  if (data.endTime) {
    execution.endTime = new Date(data.endTime);
  }
  if (data.error) {
    execution.error = data.error;
  }
  return execution;
}

/**
 * Safely parse a `.workflow` file's JSON content.
 *
 * Returns null if the content isn't valid JSON or doesn't look like a
 * WorkflowFileData (missing schemaVersion / runId / template). Callers
 * render a friendly error in that case.
 */
export function parseWorkflowFile(content: string): WorkflowFileData | null {
  if (!content || typeof content !== 'string') return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const obj = parsed as Record<string, unknown>;
  if (
    obj['schemaVersion'] !== 1 ||
    typeof obj['runId'] !== 'string' ||
    !obj['template'] ||
    typeof obj['template'] !== 'object'
  ) {
    return null;
  }
  // Trust the structure beyond this point — it's our own write format.
  return obj as unknown as WorkflowFileData;
}

/**
 * Compute the next "completed answers" array given a finished interview
 * step output.
 *
 * Pure helper extracted so the engine progress callback in App.tsx can
 * keep building the same array the tab UI displays. The tab also derives
 * this list independently from `execution.inputs` for live updates, but
 * persisting it in the file makes re-open work without recomputation.
 */
export function appendCompletedInterviewAnswers(
  prev: { stepName: string; answers: Record<string, string> }[],
  template: WorkflowTemplate,
  finishedStepIndex: number,
  inputs: Record<string, unknown>
): { stepName: string; answers: Record<string, string> }[] {
  const step = template.steps[finishedStepIndex];
  if (!step || step.type !== 'interview') return prev;
  const answersKey = `${step.id}_answers`;
  const answers = inputs[answersKey] as Record<string, string> | undefined;
  if (!answers) return prev;
  // Avoid duplicates if the engine fires the same step's progress twice.
  if (prev.some((p) => p.stepName === step.name)) return prev;
  return [...prev, { stepName: step.name, answers }];
}

/**
 * Detect whether a tab path refers to a `.workflow` file.
 */
export function isWorkflowFilePath(path: string): boolean {
  return path.toLowerCase().endsWith(FILE_EXT);
}

/**
 * Strip a synthetic in-memory tab path (legacy `__workflow_exec_*__`).
 */
export function isSyntheticWorkflowExecPath(path: string): boolean {
  return path.startsWith('__workflow_exec_') && path.endsWith('__');
}

export type { InterviewQuestion };
