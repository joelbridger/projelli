import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi } from 'vitest';
import {
  createWorkflowAuthoringLibraryComposition,
  createWorkflowRecordStartComposition,
  defineWorkflowAuthoringLibraryDescriptor,
  mountWorkflowRecordStarts,
  WorkflowRecordStartSlot,
  validateWorkflowAuthoringLibraryDescriptors,
  validateWorkflowRecordStartDescriptors,
  type WorkflowAuthoringLibraryDescriptor,
  type WorkflowRecordStartContext,
  type WorkflowRecordStartDescriptor,
} from '@/features/crm-workflows';

describe('workflow authoring public extension points', () => {
  it('lets an outside consumer append, order, and mount a typed record start', () => {
    const received = vi.fn();
    const darkMount = vi.fn(() => null);
    const earlier: WorkflowRecordStartDescriptor = {
      id: 'outside.record-start-earlier',
      order: 10,
      mount: () => null,
    };
    const later: WorkflowRecordStartDescriptor = {
      id: 'outside.record-start-later',
      order: 30,
      mount: () => null,
    };
    const appended: WorkflowRecordStartDescriptor = {
      id: 'outside.record-start-appended',
      order: 20,
      mount: (context) => (
        <button type="button" onClick={() => received(context)}>
          Start from record
        </button>
      ),
    };
    const dark: WorkflowRecordStartDescriptor = {
      id: 'outside.record-start-dark',
      order: 25,
      isEnabled: () => false,
      mount: darkMount,
    };
    const composition = createWorkflowRecordStartComposition(
      earlier,
      later,
      appended,
      dark
    );
    const fixtureIds = new Set([earlier.id, appended.id, later.id]);
    const orderedFixtures = composition.starts.filter(({ id }) =>
      fixtureIds.has(id)
    );
    const context: WorkflowRecordStartContext = {
      request: {
        kind: 'workflow',
        householdId: 'household:river',
        householdLabel: 'River household',
      },
      household: {
        id: 'household:river',
        label: 'River household',
        matterId: 'matter:river',
      },
      onRequestConsumed: vi.fn(),
    };

    expect(orderedFixtures.map(({ id }) => id)).toEqual([
      earlier.id,
      appended.id,
      later.id,
    ]);
    render(<>{mountWorkflowRecordStarts(context, composition)}</>);
    fireEvent.click(screen.getByRole('button', { name: 'Start from record' }));

    expect(received).toHaveBeenCalledWith(context);
    expect(darkMount).not.toHaveBeenCalled();
    expect(received.mock.calls[0]?.[0]).toMatchObject({
      request: {
        kind: 'workflow',
        householdId: 'household:river',
        householdLabel: 'River household',
      },
      household: {
        id: 'household:river',
        label: 'River household',
        matterId: 'matter:river',
      },
    });
  });

  it('keeps both appendable lists open-world and rejects malformed additions', () => {
    const first: WorkflowAuthoringLibraryDescriptor = {
      id: 'outside.library-first',
      order: 10,
      mountFilterControl: () => null,
    };
    const second: WorkflowAuthoringLibraryDescriptor = {
      id: 'outside.library-second',
      order: 30,
      renderDetail: () => null,
    };
    const appended = defineWorkflowAuthoringLibraryDescriptor<'published'>({
      id: 'outside.library-real-shaped-append',
      order: 20,
      isEnabled: () => true,
      mountFilterControl: () => null,
      filter: (_template, context) =>
        context.state.get() === undefined ||
        context.state.get() === 'published',
      renderDetail: () => null,
    });
    const composition = createWorkflowAuthoringLibraryComposition(
      first,
      second,
      appended
    );
    const fixtureIds = new Set([first.id, appended.id, second.id]);
    const orderedFixtures = composition.extensions.filter(({ id }) =>
      fixtureIds.has(id)
    );

    expect(orderedFixtures.map(({ id }) => id)).toEqual([
      first.id,
      appended.id,
      second.id,
    ]);
    expect(composition.extensions).toContain(appended);

    expect(() =>
      validateWorkflowAuthoringLibraryDescriptors([first, first])
    ).toThrow('duplicate id: outside.library-first');
    expect(() =>
      validateWorkflowAuthoringLibraryDescriptors([
        {
          id: 'outside.no-slot',
          order: 10,
        },
      ])
    ).toThrow('filter-control or detail-render slot is required');
    expect(() =>
      validateWorkflowRecordStartDescriptors([
        {
          id: 'outside.bad-record-start',
          order: Number.NaN,
          mount: () => null,
        },
      ])
    ).toThrow('order must be finite: outside.bad-record-start');
  });

  it('lets an outside consumer compile against the sanctioned host slot', () => {
    const received = vi.fn();
    const appended: WorkflowRecordStartDescriptor = {
      id: 'outside.quick-add-consumer',
      order: 20,
      mount: (context) => {
        received(context);
        return null;
      },
    };

    const { container } = render(
      <WorkflowRecordStartSlot
        addRequest={{
          kind: 'workflow',
          householdId: 'household:river',
          householdLabel: 'River household',
        }}
        households={[
          {
            id: 'household:river',
            label: 'River household',
            matterId: 'matter:river',
          },
        ]}
        onAddRequestConsumed={vi.fn()}
        composition={createWorkflowRecordStartComposition(appended)}
      />
    );

    expect(container).toBeEmptyDOMElement();
    expect(received).toHaveBeenCalledTimes(1);
    expect(received.mock.calls[0]?.[0]).toMatchObject({
      household: { matterId: 'matter:river' },
      openTemplateLibrary: expect.any(Function),
    });
  });
});
