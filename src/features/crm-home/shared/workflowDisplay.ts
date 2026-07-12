import { stepValue, type LiveWorkflowInstance } from '../workflowLive';

export function displayValue(value: unknown): string {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
  return value === undefined || value === null ? '' : JSON.stringify(value);
}

export function liveStepTitle(instance: LiveWorkflowInstance, stepId: string): string {
  return displayValue(stepValue(instance, stepId, 'title')) || instance.snapshot.steps[stepId]?.titleSnapshot || 'Untitled step';
}
