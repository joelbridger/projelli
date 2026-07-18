import type {
  LiveWorkflowInstance,
  WorkflowCompletionValidation,
} from '@/features/crm-home/workflowLive';
import {
  readWorkflowStepTiming,
  type WorkflowStepDependentDueRule,
} from './workflowStepPersistence';

const DEPENDENT_DUE_METADATA_KEY = 'workflowDependentDue';

type WorkflowStepTimingHistory = {
  baseAt: string | null;
  dueAt: string | null;
};

type StoredDependentDueMetadata = {
  version: 1 | 2;
  sequential: boolean;
  steps: Record<string, WorkflowStepDependentDueRule>;
  completed?: Record<string, WorkflowStepTimingHistory>;
};

/**
 * A test may observe this symbol to prove whether this real implementation was
 * evaluated. It deliberately reports from the implementation itself instead
 * of replacing the lazy import with a mock.
 */
if (import.meta.env.MODE === 'test') {
  const loadObserver = Reflect.get(
    globalThis,
    Symbol.for('lantern.workflowDependentDueCompletionLogic.loadObserver'),
  ) as unknown;
  if (typeof loadObserver === 'function') {
    const observeLoad = loadObserver as () => void;
    observeLoad();
  }
}

function validIso(value: unknown): value is string {
  return typeof value === 'string' && value.trim() === value && !Number.isNaN(Date.parse(value));
}

function latestCompletionTime(
  instance: LiveWorkflowInstance,
  stepId: string,
): string | undefined {
  const operations = instance.snapshot.steps[stepId]?.completionOperations ?? [];
  return operations.flatMap((operation) => (
    validIso(operation.completedAt) ? [operation.completedAt] : []
  )).at(-1);
}

/** Shared fail-closed validator used by every canonical completion entry point. */
export function validateWorkflowDependentDueCompletion(request: {
  instance: LiveWorkflowInstance;
  stepId: string;
}): WorkflowCompletionValidation {
  try {
    const timing = readWorkflowStepTiming(request.instance, request.stepId);
    if (!timing.sequential || !timing.blockedByStepId) return { ok: true };
    const blockedTitle = request.instance.snapshot.steps[timing.blockedByStepId]?.titleSnapshot;
    return {
      ok: false,
      refusal: {
        code: 'workflow_dependency_incomplete',
        message: blockedTitle
          ? `Finish “${blockedTitle}” before completing this step.`
          : 'Finish the required earlier step before completing this step.',
      },
    };
  } catch {
    return {
      ok: false,
      refusal: {
        code: 'workflow_dependency_invalid',
        message: 'Review this workflow’s step timing rules before completing work.',
      },
    };
  }
}

/** Saves the displayed base/due pair into the same durable extension bag. */
export function freezeWorkflowDependentDueCompletion(
  completedInstance: LiveWorkflowInstance,
  stepId: string,
): LiveWorkflowInstance {
  const timing = readWorkflowStepTiming(completedInstance, stepId);
  const rule = timing.rule;
  if (!rule) return completedInstance;

  // readWorkflowStepTiming has already validated the complete stored bag.
  const metadata = completedInstance[DEPENDENT_DUE_METADATA_KEY] as StoredDependentDueMetadata;
  const completed = metadata.version === 2 ? metadata.completed ?? {} : {};
  if (completed[stepId]) return completedInstance;

  const baseAt = rule.base === 'workflow_start'
    ? (validIso(completedInstance.createdAt) ? completedInstance.createdAt : undefined)
    : latestCompletionTime(completedInstance, rule.predecessorStepId ?? '');
  const next = structuredClone(completedInstance);
  next[DEPENDENT_DUE_METADATA_KEY] = {
    version: 2,
    sequential: metadata.sequential,
    steps: structuredClone(metadata.steps),
    completed: {
      ...structuredClone(completed),
      [stepId]: { baseAt: baseAt ?? null, dueAt: timing.dueAt ?? null },
    },
  } satisfies StoredDependentDueMetadata;
  return next;
}
