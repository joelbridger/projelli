import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  applyWorkflowStepCompletion,
  completeWorkflowStep,
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

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('workflow completion seam', () => {
  it('is byte-identical to the pure completion helper before validators are registered', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-18T12:00:00.000Z'));
    vi.spyOn(Math, 'random').mockReturnValue(0.12345);
    const { instance, stepId } = workflowInstance('empty-validator-instance');

    const canonicalOutput = applyWorkflowStepCompletion(instance, stepId);
    const pureHelperOutput = completeWorkflowStep(instance, stepId);

    expect(JSON.stringify(canonicalOutput)).toBe(JSON.stringify(pureHelperOutput));
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

  it('surfaces a typed refusal and prevents every production completion entry from producing a saveable instance', () => {
    const refusal = {
      code: 'dependency_incomplete',
      message: 'Finish the required earlier step first.',
    };
    registerWorkflowCompletionValidator(({ instance }) => instance.id === blockedInstanceId
      ? { ok: false, refusal }
      : { ok: true });
    const { instance, stepId } = workflowInstance(blockedInstanceId);

    for (const entryPoint of [
      'Workflows per-step completion button',
      'Today workflow work-item completion',
      'Migration checklist completion loop',
    ]) {
      try {
        applyWorkflowStepCompletion(instance, stepId);
        throw new Error(`${entryPoint} unexpectedly produced a saveable instance.`);
      } catch (error) {
        expect(error).toBeInstanceOf(WorkflowCompletionRefusedError);
        expect((error as WorkflowCompletionRefusedError).refusal).toEqual(refusal);
        expect((error as Error).message).toBe(refusal.message);
      }
    }
  });

  it('has no production direct callers of the retired helper', () => {
    // Whole-tree scope: src/**/*.ts(x). Excludes test/spec files and __tests__ directories;
    // workflowLive.ts is the sole sanctioned pure-helper owner.
    const sourceRoot = join(process.cwd(), 'src');
    const productionFiles = sourceFiles(sourceRoot).filter((file) =>
      /\.(?:ts|tsx)$/.test(file) &&
      !/(?:\.test\.|\.spec\.|\/__tests__\/)/.test(file) &&
      relative(sourceRoot, file) !== 'features/crm-home/workflowLive.ts'
    );
    const directCallers = productionFiles.filter((file) =>
      /\bcompleteWorkflowStep\s*\(/.test(readFileSync(file, 'utf8'))
    ).map((file) => relative(process.cwd(), file));

    expect(directCallers).toEqual([]);
  });
});

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(file) : [file];
  });
}
