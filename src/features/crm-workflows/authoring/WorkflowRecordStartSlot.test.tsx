import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CrmHouseholdAddRequest } from '@/features/crm-home';
import { setDevFlagOverride } from '@/platform/flags';
import {
  createWorkflowRecordStartComposition,
  openWorkflowTemplateLibrary,
  type WorkflowRecordStartDescriptor,
} from './workflowAuthoringExtensionPoints';
import { WorkflowRecordStartSlot } from './WorkflowRecordStartSlot';

const request: CrmHouseholdAddRequest = {
  kind: 'workflow',
  householdId: 'household:river',
  householdLabel: 'River household',
};

describe('WorkflowRecordStartSlot', () => {
  afterEach(() => {
    setDevFlagOverride('workflow-authoring', undefined);
  });

  it('is byte-empty while every contribution is dark and reads no request data', () => {
    const mount = vi.fn(() => null);
    const dark: WorkflowRecordStartDescriptor = {
      id: 'outside.dark-record-start',
      order: 10,
      isEnabled: () => false,
      mount,
    };
    const households = new Proxy([], {
      get() {
        throw new Error('dark slot read household data');
      },
    }) as never[];

    const { container } = render(
      <WorkflowRecordStartSlot
        addRequest={request}
        households={households}
        onAddRequestConsumed={vi.fn()}
        composition={createWorkflowRecordStartComposition(dark)}
      />
    );

    expect(container).toBeEmptyDOMElement();
    expect(mount).not.toHaveBeenCalled();
  });

  it('ignores unrelated record requests without mounting a workflow child', () => {
    const mount = vi.fn(() => null);
    const contribution: WorkflowRecordStartDescriptor = {
      id: 'outside.workflow-only',
      order: 10,
      mount,
    };

    const { container } = render(
      <WorkflowRecordStartSlot
        addRequest={{ ...request, kind: 'task' }}
        households={[]}
        onAddRequestConsumed={vi.fn()}
        composition={createWorkflowRecordStartComposition(contribution)}
      />
    );

    expect(container).toBeEmptyDOMElement();
    expect(mount).not.toHaveBeenCalled();
  });

  it('normalizes the household and opens the landed library through the public action', () => {
    setDevFlagOverride('workflow-authoring', true);
    const received = vi.fn();
    const contribution: WorkflowRecordStartDescriptor = {
      id: 'outside.quick-add',
      order: 10,
      mount: (context) => (
        <button
          type="button"
          data-testid="outside-open-real-library"
          onClick={() => {
            received(context);
            openWorkflowTemplateLibrary(context);
          }}
        />
      ),
    };
    const composition = createWorkflowRecordStartComposition(contribution);
    const consumed = vi.fn();

    function Harness() {
      const [addRequest, setAddRequest] =
        useState<CrmHouseholdAddRequest | null>(request);
      return (
        <WorkflowRecordStartSlot
          {...(addRequest ? { addRequest } : {})}
          households={[
            {
              id: 'household:river',
              label: 'Canonical household label',
              matterId: 'matter:river',
            },
          ]}
          onAddRequestConsumed={() => {
            consumed();
            setAddRequest(null);
          }}
          templateId="workflow-template:draft"
          composition={composition}
        />
      );
    }

    render(<Harness />);
    fireEvent.click(screen.getByTestId('outside-open-real-library'));

    expect(received).toHaveBeenCalledTimes(1);
    expect(received.mock.calls[0]?.[0]).toMatchObject({
      request,
      household: {
        id: 'household:river',
        label: 'River household',
        matterId: 'matter:river',
      },
    });
    expect(consumed).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('workflow-authoring-library')).toBeVisible();
    expect(
      screen.queryByTestId('outside-open-real-library')
    ).not.toBeInTheDocument();
  });

  it('guards consumption once and fails loudly without the sanctioned slot', () => {
    const contribution: WorkflowRecordStartDescriptor = {
      id: 'outside.double-consume',
      order: 10,
      mount: (context) => (
        <button
          type="button"
          data-testid="outside-consume-twice"
          onClick={() => {
            context.onRequestConsumed();
            context.onRequestConsumed();
          }}
        />
      ),
    };
    const consumed = vi.fn();
    render(
      <WorkflowRecordStartSlot
        addRequest={request}
        households={[]}
        onAddRequestConsumed={consumed}
        composition={createWorkflowRecordStartComposition(contribution)}
      />
    );

    fireEvent.click(screen.getByTestId('outside-consume-twice'));
    expect(consumed).toHaveBeenCalledTimes(1);

    expect(() => {
      openWorkflowTemplateLibrary({
        request: {
          kind: 'workflow',
          householdId: 'household:river',
          householdLabel: 'River household',
        },
        household: { id: 'household:river', label: 'River household' },
        onRequestConsumed: vi.fn(),
      });
    }).toThrow('mount through WorkflowRecordStartSlot');
  });
});
