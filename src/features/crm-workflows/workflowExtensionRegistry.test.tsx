/* eslint-disable lantern-i18n/no-hardcoded-string -- Dummy labels are test-only registry mounts. */
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createTemplate,
  startWorkflow,
} from '@/features/crm-home/workflowLive';
import {
  workflowStepExtensionRegistry as publicWorkflowStepExtensionRegistry,
  type WorkflowStepExtensionDescriptor as PublicWorkflowStepExtensionDescriptor,
} from '@/features/crm-workflows';
import {
  getWorkflowRules,
  getWorkflowStepExtensions,
  mountWorkflowRules,
  mountWorkflowStepExtensions,
  validateWorkflowRuleDescriptors,
  validateWorkflowStepExtensionDescriptors,
  workflowStepExtensionRegistry,
  type WorkflowRuleDescriptor,
  type WorkflowStepExtensionDescriptor,
} from './workflowExtensionRegistry';
import { setDevFlagOverride } from '@/platform/flags';

declare module './workflowExtensionRegistry' {
  interface WorkflowRuleIdMap {
    'test.dummy-rule': true;
  }
  interface WorkflowStepExtensionIdMap {
    'test.dummy-step': true;
  }
}

const template = createTemplate('Annual review', ['Prepare', 'Meet']);
const instance = startWorkflow(template, {
  id: 'household-1',
  label: 'Morgan',
});

afterEach(() => {
  setDevFlagOverride('workflow-dependent-due', undefined);
});

describe('workflow extension registries', () => {
  it('exports the step-extension registry through the public doorway', () => {
    const descriptor: PublicWorkflowStepExtensionDescriptor | undefined =
      publicWorkflowStepExtensionRegistry[0];

    expect(publicWorkflowStepExtensionRegistry).toBe(
      workflowStepExtensionRegistry
    );
    expect(descriptor?.id).toBe('legacy.step-controls');
  });

  it('keeps compatibility descriptors in stable order', () => {
    expect(getWorkflowRules().map(({ id }) => id)).toEqual([
      'legacy.schedule-and-outcomes',
      'workflow-authoring.library',
    ]);
    expect(getWorkflowStepExtensions().map(({ id }) => id)).toEqual([
      'legacy.step-controls',
      'workflow-step.attachments',
      'workflow-step.dependent-due',
    ]);
  });

  it('mounts the registered dependency extension only when its flag is on', () => {
    const descriptor = getWorkflowStepExtensions().find(
      ({ id }) => id === 'workflow-step.dependent-due'
    );
    if (!descriptor) throw new Error('Expected the dependency extension descriptor.');
    const saveStepMetadata = vi.fn().mockResolvedValue(instance);
    const stepId = Object.keys(instance.snapshot.steps)[1];
    if (!stepId) throw new Error('Expected a dependent workflow step.');
    const unreadableInstance = new Proxy(instance, {
      get(target, property, receiver) {
        if (property === 'snapshot') throw new Error('Flag-off metadata read');
        return Reflect.get(target, property, receiver) as unknown;
      },
    });

    setDevFlagOverride('workflow-dependent-due', false);
    const off = render(<>{descriptor.mount({
      instance: unreadableInstance,
      stepId,
      saveStepMetadata,
      compatibilityMount: null,
    })}</>);
    expect(off.container).toBeEmptyDOMElement();
    expect(saveStepMetadata).not.toHaveBeenCalled();
    off.unmount();

    setDevFlagOverride('workflow-dependent-due', true);
    render(<>{descriptor.mount({
      instance,
      stepId,
      saveStepMetadata,
      compatibilityMount: null,
    })}</>);
    expect(screen.getByTestId(`workflow-dependent-due-${instance.id}-${stepId}`))
      .toBeInTheDocument();
  });

  it('mounts a rule and step extension without a shell switch edit', () => {
    const dummyRule: WorkflowRuleDescriptor = {
      id: 'test.dummy-rule',
      order: 20,
      mount: () => <span>Dummy workflow rule</span>,
    };
    const dummyStep: WorkflowStepExtensionDescriptor = {
      id: 'test.dummy-step',
      order: 20,
      mount: () => <span>Dummy workflow step extension</span>,
    };

    render(
      <>
        {mountWorkflowRules({ template, compatibilityMount: null }, [
          dummyRule,
        ])}
        {mountWorkflowStepExtensions(
          {
            instance,
            stepId: Object.keys(instance.snapshot.steps)[0] ?? 'step-1',
            saveStepMetadata: vi.fn().mockResolvedValue(instance),
            compatibilityMount: null,
          },
          [dummyStep]
        )}
      </>
    );

    expect(screen.getByText('Dummy workflow rule')).toBeInTheDocument();
    expect(
      screen.getByText('Dummy workflow step extension')
    ).toBeInTheDocument();
  });

  it('rejects duplicate ids and malformed descriptors clearly', () => {
    const rule = getWorkflowRules()[0];
    const step = getWorkflowStepExtensions()[0];
    if (!rule || !step) throw new Error('Expected compatibility descriptors');

    expect(() => {
      validateWorkflowRuleDescriptors([rule, rule]);
    }).toThrow('duplicate id: legacy.schedule-and-outcomes');
    expect(() => {
      validateWorkflowStepExtensionDescriptors([step, step]);
    }).toThrow('duplicate id: legacy.step-controls');
    expect(() => {
      validateWorkflowRuleDescriptors([{ ...rule, order: Number.NaN }]);
    }).toThrow('order must be finite: legacy.schedule-and-outcomes');
    expect(() => {
      validateWorkflowStepExtensionDescriptors([
        { ...step, mount: null as never },
      ]);
    }).toThrow('mount must be a function: legacy.step-controls');
  });

  it('keeps misspelled ids out at type-check time', () => {
    const invalid: WorkflowRuleDescriptor = {
      // @ts-expect-error This id is not registered through module augmentation.
      id: 'legacy.schedule-and-outcome',
      order: 10,
      mount: () => null,
    };
    expect(invalid.id).toBe('legacy.schedule-and-outcome');
  });
});
