import type { WorkflowStepProgress } from '@/platform/crm/types';
import { stepValue, type LiveWorkflowInstance } from '../workflowLive';
import type { CrmWorkflowWorkItem } from '../types';
import { liveStepTitle } from './workflowDisplay';

function storedTagIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((id): id is string => typeof id === 'string' && Boolean(id.trim())))];
}

/** Canonical started-step state projected into the shared Tasks/Today work shape. */
export function projectCrmWorkflowWorkItem(
  instance: LiveWorkflowInstance,
  step: WorkflowStepProgress,
  assigneeLabel?: string
): CrmWorkflowWorkItem {
  const assigneeUserId = step.assigneeUserId ?? null;
  const dueValue = stepValue(instance, step.stepId, 'dueOffset');
  const offset = typeof dueValue === 'number' ? dueValue : undefined;
  const started = new Date(instance['createdAt'] ?? new Date().toISOString());
  if (offset !== undefined) started.setUTCDate(started.getUTCDate() + offset);
  return {
    id: `${instance.id}:${step.stepId}`,
    instanceId: instance.id,
    stepId: step.stepId,
    title: liveStepTitle(instance, step.stepId),
    workflowLabel: instance.name,
    householdId: instance.householdId,
    householdLabel: instance.householdLabel,
    assigneeUserId,
    ...(assigneeLabel ? { assigneeLabel } : {}),
    status: step.status === 'in_progress' ? 'in_progress' : 'open',
    priority: 'normal',
    ...(offset !== undefined ? { dueAt: started.toISOString().slice(0, 10) } : {}),
    tagIds: storedTagIds(step.tagIds),
  };
}
