import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  LiveWorkflowInstance,
  WorkflowCompletionValidator,
} from '@/features/crm-home/workflowLive';

afterEach(() => {
  vi.doUnmock('./workflowDependentDueCompletionLogic');
  vi.resetModules();
});

describe('workflow dependent-due completion registration', () => {
  it('does not load or enforce dependent-due completion logic while the flag is off', async () => {
    vi.resetModules();
    const heavyModuleLoad = vi.fn();
    vi.doMock('./workflowDependentDueCompletionLogic', () => {
      heavyModuleLoad();
      return {
        validateWorkflowDependentDueCompletion: vi.fn(),
        freezeWorkflowDependentDueCompletion: vi.fn(),
      };
    });
    const { registerWorkflowDependentDueCompletion } = await import(
      './workflowDependentDueCompletionRegistration'
    );
    const validators: WorkflowCompletionValidator[] = [];
    const complete = vi.fn((instance: LiveWorkflowInstance) => ({
      ...instance,
      status: 'completed' as const,
    }));
    const completion = registerWorkflowDependentDueCompletion((validator) => {
      validators.push(validator);
    });
    const instance = {
      id: 'flag-off-instance',
      kind: 'crm_workflow_instance',
    } as unknown as LiveWorkflowInstance;

    expect(validators).toHaveLength(1);
    expect(validators[0]?.({ instance, stepId: 'step-1' })).toEqual({ ok: true });
    expect(completion(instance, 'step-1', undefined, complete)).toMatchObject({
      status: 'completed',
    });
    expect(complete).toHaveBeenCalledOnce();
    expect(heavyModuleLoad).not.toHaveBeenCalled();
  });
});
