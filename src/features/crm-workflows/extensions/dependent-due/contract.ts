import type { WorkflowStepExtensionContext } from '@/features/crm-workflows';
import {
  readWorkflowStepTiming,
  type WorkflowDueBase,
  type WorkflowDueDirection,
  type WorkflowDueUnit,
  type WorkflowStepTimingState,
} from '../../workflowStepPersistence';

export interface SaveWorkflowStepTimingInput {
  base: WorkflowDueBase;
  direction: WorkflowDueDirection;
  offset: number;
  unit: WorkflowDueUnit;
  sequential: boolean;
}

/** Returns the durable rule plus its due time derived from the saved workflow. */
export function getWorkflowStepTiming(
  context: WorkflowStepExtensionContext,
): WorkflowStepTimingState {
  return readWorkflowStepTiming(context.instance, context.stepId);
}

/** Saves one rule. Previous-step rules always use the immediate saved predecessor. */
export async function saveWorkflowStepTiming(
  context: WorkflowStepExtensionContext,
  input: SaveWorkflowStepTimingInput,
): Promise<WorkflowStepTimingState> {
  const order = Object.values(context.instance.snapshot.steps).map((step) => step.stepId);
  const position = order.indexOf(context.stepId);
  if (position < 0) throw new Error('This workflow step is no longer available.');
  const predecessorStepId = position > 0 ? order[position - 1] : undefined;
  const saved = await context.saveStepMetadata({
    sequential: input.sequential,
    dependentDue: {
      base: input.base,
      direction: input.direction,
      offset: input.offset,
      unit: input.unit,
      ...(input.base === 'predecessor_completion' && predecessorStepId
        ? { predecessorStepId }
        : {}),
    },
  });
  return readWorkflowStepTiming(saved, context.stepId);
}
