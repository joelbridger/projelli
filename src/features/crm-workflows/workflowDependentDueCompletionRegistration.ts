import type {
  LiveWorkflowInstance,
  WorkflowCompletionValidator,
} from '@/features/crm-home/workflowLive';
import { isEnabled } from '@/platform/flags';
import { BRAND } from '@/config/brand';

type CompletionLogic = typeof import('./workflowDependentDueCompletionLogic');
type CompleteWorkflowStep = (
  instance: LiveWorkflowInstance,
  stepId: string,
  outcomeId?: string,
) => LiveWorkflowInstance;

let completionLogic: CompletionLogic | undefined;
let completionLogicLoad: Promise<CompletionLogic> | undefined;
let completionLogicLoadFailed = false;

function loadCompletionLogic(): Promise<CompletionLogic> {
  completionLogicLoad ??= import('./workflowDependentDueCompletionLogic').then((loaded) => {
    completionLogic = loaded;
    return loaded;
  });
  return completionLogicLoad;
}

function startCompletionLogicLoad(): void {
  void loadCompletionLogic().catch(() => {
    completionLogicLoadFailed = true;
  });
}

/** Allows a flag-on app boot or focused test to finish the one lazy import. */
export async function prepareWorkflowDependentDueCompletion(): Promise<void> {
  if (!isEnabled('workflow-dependent-due')) return;
  await loadCompletionLogic();
}

export type WorkflowDependentDueCompletion = (
  instance: LiveWorkflowInstance,
  stepId: string,
  outcomeId: string | undefined,
  complete: CompleteWorkflowStep,
) => LiveWorkflowInstance;

/**
 * Installs the built-in guard beside the canonical seam and returns its
 * history-preserving completion wrapper. The flag check is deliberately the
 * first operation in both paths.
 */
export function registerWorkflowDependentDueCompletion(
  register: (validator: WorkflowCompletionValidator) => void,
): WorkflowDependentDueCompletion {
  if (isEnabled('workflow-dependent-due')) startCompletionLogicLoad();

  register((request) => {
    if (!isEnabled('workflow-dependent-due')) return { ok: true };
    if (!completionLogic) {
      startCompletionLogicLoad();
      return {
        ok: false,
        refusal: {
          code: completionLogicLoadFailed
            ? 'workflow_dependency_invalid'
            : 'workflow_dependency_loading',
          message: completionLogicLoadFailed
            ? `Workflow timing checks could not load. Restart ${BRAND.name} and try again.`
            : 'Workflow timing checks are loading. Try again in a moment.',
        },
      };
    }
    return completionLogic.validateWorkflowDependentDueCompletion(request);
  });

  return (instance, stepId, outcomeId, complete) => {
    if (!isEnabled('workflow-dependent-due')) {
      return complete(instance, stepId, outcomeId);
    }
    if (!completionLogic) {
      throw new Error('Workflow timing checks must finish loading before completion.');
    }
    return completionLogic.freezeWorkflowDependentDueCompletion(
      complete(instance, stepId, outcomeId),
      stepId,
    );
  };
}
