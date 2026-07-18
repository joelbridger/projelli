import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  applyWorkflowStepCompletion,
  createTemplate,
  registerWorkflowCompletionValidator,
  startWorkflow,
  WorkflowCompletionRefusedError,
} from './workflowLive';

const blockedInstanceId = 'workflow-completion-seam-blocked-instance';

function workflowInstance(id: string) {
  const template = createTemplate('Annual review', ['Prepare review']);
  const [step] = template.steps;
  if (!step) throw new Error('Expected a workflow step.');
  return {
    instance: startWorkflow(
      template,
      { id: 'river-household', label: 'River household' },
      { id }
    ),
    stepId: step.id,
  };
}

function workflowStep(
  instance: ReturnType<typeof startWorkflow>,
  stepId: string
) {
  const step = instance.snapshot.steps[stepId];
  if (!step) throw new Error('Expected a workflow instance step.');
  return step;
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('workflow completion seam', () => {
  it('keeps the empty-validator output byte-identical to the pre-seam baseline', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-18T12:00:00.000Z'));
    vi.spyOn(Math, 'random').mockReturnValue(0.12345);
    const { instance, stepId } = workflowInstance('empty-validator-instance');

    const outputBytes = JSON.stringify(
      applyWorkflowStepCompletion(instance, stepId)
    );

    expect(outputBytes).toHaveLength(7141);
    expect(createHash('sha256').update(outputBytes).digest('hex')).toBe(
      'fc307244a38bb17ffa76dc75f48f1fd906c153559b7f29a6f0ecf3056e2de409'
    );
  });

  it('runs validators in registration order', () => {
    const calls: string[] = [];
    registerWorkflowCompletionValidator(() => {
      calls.push('first');
      return { ok: true };
    });
    registerWorkflowCompletionValidator(() => {
      calls.push('second');
      return { ok: true };
    });
    const { instance, stepId } = workflowInstance('ordered-instance');

    applyWorkflowStepCompletion(instance, stepId);

    expect(calls).toEqual(['first', 'second']);
  });

  it('gives each validator a defensive snapshot instead of the live instance', () => {
    const guardedInstanceId = 'defensive-validator-instance';
    const observations: string[] = [];
    registerWorkflowCompletionValidator(({ instance, stepId }) => {
      if (instance.id !== guardedInstanceId) return { ok: true };
      const step = workflowStep(instance, stepId);
      step.status = 'in_progress';
      observations.push(step.status);
      return { ok: true };
    });
    registerWorkflowCompletionValidator(({ instance, stepId }) => {
      if (instance.id !== guardedInstanceId) return { ok: true };
      observations.push(workflowStep(instance, stepId).status);
      return { ok: true };
    });
    const { instance, stepId } = workflowInstance(guardedInstanceId);

    const completed = applyWorkflowStepCompletion(instance, stepId);

    expect(observations).toEqual(['in_progress', 'todo']);
    expect(workflowStep(instance, stepId).status).toBe('todo');
    expect(workflowStep(completed, stepId).status).toBe('done');
  });

  it('surfaces a typed refusal without producing a saveable instance', () => {
    const refusal = {
      code: 'dependency_incomplete',
      message: 'Finish the required earlier step first.',
    };
    registerWorkflowCompletionValidator(({ instance }) =>
      instance.id === blockedInstanceId ? { ok: false, refusal } : { ok: true }
    );
    const { instance, stepId } = workflowInstance(blockedInstanceId);

    expect(() => applyWorkflowStepCompletion(instance, stepId)).toThrow(
      WorkflowCompletionRefusedError
    );
    try {
      applyWorkflowStepCompletion(instance, stepId);
    } catch (error) {
      expect((error as WorkflowCompletionRefusedError).refusal).toEqual(
        refusal
      );
      expect((error as Error).message).toBe(refusal.message);
    }
    expect(workflowStep(instance, stepId).status).toBe('todo');
  });

  it('keeps the retired helper private and has no production bypass reference', () => {
    // Whole-tree scope: src/**/*.ts(x). Excludes test/spec files and __tests__ directories;
    // workflowLive.ts is the sole sanctioned pure-helper owner.
    const sourceRoot = join(process.cwd(), 'src');
    const productionFiles = sourceFiles(sourceRoot).filter(
      (file) =>
        /\.(?:ts|tsx)$/.test(file) &&
        !/(?:\.test\.|\.spec\.|\/__tests__\/)/.test(file) &&
        relative(sourceRoot, file) !== 'features/crm-home/workflowLive.ts'
    );
    const workflowLive = readFileSync(
      join(sourceRoot, 'features/crm-home/workflowLive.ts'),
      'utf8'
    );
    const bypassReferences = productionFiles
      .filter((file) =>
        /\bcompleteWorkflowStep\b/.test(readFileSync(file, 'utf8'))
      )
      .map((file) => relative(process.cwd(), file));

    expect(workflowLive).toMatch(/\nfunction completeWorkflowStep\s*\(/);
    expect(workflowLive).not.toMatch(
      /\bexport\s+(?:async\s+)?function\s+completeWorkflowStep\b/
    );
    expect(workflowLive).not.toMatch(
      /\bexport\s*\{[^}]*\bcompleteWorkflowStep\b[^}]*\}/s
    );
    expect(bypassReferences).toEqual([]);
  });
});

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(file) : [file];
  });
}
