import '@/i18n';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTemplate, startWorkflow, type LiveWorkflowInstance } from '@/features/crm-home/workflowLive';
import type { WorkflowStepExtensionContext, WorkflowStepMetadataPatch } from '@/features/crm-workflows';
import { setDevFlagOverride } from '@/platform/flags';
import { patchWorkflowStepMetadata } from '../../workflowStepPersistence';
import { WorkflowDependentDue } from './WorkflowDependentDue';
import { getWorkflowStepTiming, saveWorkflowStepTiming } from './contract';

function makeContext(): {
  context: WorkflowStepExtensionContext;
  firstId: string;
  secondId: string;
  saves: LiveWorkflowInstance[];
} {
  const template = createTemplate('Annual review', ['Prepare', 'Meet']);
  let saved = startWorkflow(template, { id: 'river-household', label: 'River household' });
  saved.createdAt = '2026-07-01T09:00:00.000Z';
  const [firstId, secondId] = Object.keys(saved.snapshot.steps);
  if (!firstId || !secondId) throw new Error('Expected two workflow steps.');
  const saves: LiveWorkflowInstance[] = [];
  const saveStepMetadata = vi.fn((patch: WorkflowStepMetadataPatch) => {
    saved = patchWorkflowStepMetadata(saved, secondId, patch);
    const reloaded = structuredClone(saved);
    saves.push(reloaded);
    return Promise.resolve(reloaded);
  });
  return {
    context: { instance: saved, stepId: secondId, saveStepMetadata, compatibilityMount: null },
    firstId,
    secondId,
    saves,
  };
}

afterEach(() => {
  cleanup();
  setDevFlagOverride('workflow-dependent-due', undefined);
});

describe('workflow dependent due extension', () => {
  it('is inert while flag-off with no workflow read, control, gap, or save setup', () => {
    const test = makeContext();
    const unreadable = new Proxy(test.context.instance, {
      get(target, property, receiver) {
        if (property === 'snapshot') throw new Error('Flag-off workflow read');
        return Reflect.get(target, property, receiver) as unknown;
      },
    });
    setDevFlagOverride('workflow-dependent-due', false);

    const { container } = render(
      <WorkflowDependentDue context={{ ...test.context, instance: unreadable }} />
    );

    expect(container).toBeEmptyDOMElement();
    expect(test.context.saveStepMetadata).not.toHaveBeenCalled();
    expect(screen.queryByTestId('workflow-dependent-due-save')).not.toBeInTheDocument();
  });

  it('saves the one immediate predecessor, explicit due rule, and sequence setting', async () => {
    const test = makeContext();
    setDevFlagOverride('workflow-dependent-due', true);
    render(<WorkflowDependentDue context={test.context} />);

    fireEvent.change(screen.getByTestId('workflow-dependent-due-base'), {
      target: { value: 'predecessor_completion' },
    });
    fireEvent.change(screen.getByTestId('workflow-dependent-due-direction'), {
      target: { value: 'after' },
    });
    fireEvent.change(screen.getByTestId('workflow-dependent-due-offset'), {
      target: { value: '3' },
    });
    fireEvent.change(screen.getByTestId('workflow-dependent-due-unit'), {
      target: { value: 'weeks' },
    });
    fireEvent.click(screen.getByTestId('workflow-dependent-due-sequential'));
    fireEvent.click(screen.getByTestId('workflow-dependent-due-save'));

    await waitFor(() => {
      expect(screen.getByTestId('workflow-dependent-due-message')).toHaveTextContent('Step timing saved.');
    });
    expect(test.saves).toHaveLength(1);
    const saved = test.saves[0];
    if (!saved) throw new Error('Expected saved timing.');
    expect(getWorkflowStepTiming({ ...test.context, instance: saved })).toMatchObject({
      sequential: true,
      rule: {
        base: 'predecessor_completion',
        predecessorStepId: test.firstId,
        direction: 'after',
        offset: 3,
        unit: 'weeks',
      },
      blockedByStepId: test.firstId,
    });
  });

  it('does not offer a predecessor for the first saved step', () => {
    const test = makeContext();
    setDevFlagOverride('workflow-dependent-due', true);
    render(<WorkflowDependentDue context={{ ...test.context, stepId: test.firstId }} />);

    expect(screen.getByTestId('workflow-dependent-due-base')).toHaveTextContent('Workflow start');
    expect(screen.getByTestId('workflow-dependent-due-base')).not.toHaveTextContent('Previous step completed');
  });

  it('exposes a minimal contract that delegates persistence to the mounted callback', async () => {
    const test = makeContext();
    await saveWorkflowStepTiming(test.context, {
      base: 'workflow_start',
      direction: 'before',
      offset: 2,
      unit: 'days',
      sequential: false,
    });

    expect(test.context.saveStepMetadata).toHaveBeenCalledOnce();
    expect(test.context.saveStepMetadata).toHaveBeenCalledWith({
      sequential: false,
      dependentDue: {
        base: 'workflow_start',
        direction: 'before',
        offset: 2,
        unit: 'days',
      },
    });
  });
});
