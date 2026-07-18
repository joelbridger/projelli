import { afterEach, describe, expect, it, vi } from 'vitest';

const IMPLEMENTATION_LOAD_OBSERVER = Symbol.for(
  'lantern.workflowDependentDueCompletionLogic.loadObserver',
);

afterEach(() => {
  Reflect.deleteProperty(globalThis, IMPLEMENTATION_LOAD_OBSERVER);
  vi.resetModules();
});

describe('workflow dependent-due completion registration', () => {
  it('keeps the real completion implementation unloaded on the workflowLive public-index path while the flag is off', async () => {
    vi.resetModules();
    const implementationLoad = vi.fn();
    Reflect.set(globalThis, IMPLEMENTATION_LOAD_OBSERVER, implementationLoad);

    const { setDevFlagOverride } = await import('@/platform/flags');
    setDevFlagOverride('workflow-dependent-due', false);
    const {
      applyWorkflowStepCompletion,
      createTemplate,
      startWorkflow,
    } = await import('@/features/crm-home/workflowLive');
    const { prepareWorkflowDependentDueCompletion } = await import('@/features/crm-workflows');

    const template = createTemplate('Flag-off workflow', ['Complete normally']);
    const instance = startWorkflow(template, {
      id: 'flag-off-household',
      label: 'Flag-off household',
    });
    const stepId = Object.keys(instance.snapshot.steps)[0];
    if (!stepId) throw new Error('Expected the workflow fixture to contain one step.');

    expect(applyWorkflowStepCompletion(instance, stepId).snapshot.steps[stepId]?.status)
      .toBe('done');
    await prepareWorkflowDependentDueCompletion();
    expect(implementationLoad).not.toHaveBeenCalled();

    // Prove the observer is attached to the real implementation, rather than
    // passing because the assertion watches an unrelated wrapper.
    setDevFlagOverride('workflow-dependent-due', true);
    await prepareWorkflowDependentDueCompletion();
    expect(implementationLoad).toHaveBeenCalledOnce();
  });
});
