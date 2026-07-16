import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  WorkflowRecordStartContext,
  WorkflowTemplateRecord,
} from '@/features/crm-workflows';
import { WorkflowRecordQuickAdd } from './WorkflowRecordQuickAdd';
import { workflowRecordQuickAddDescriptor } from './descriptor';

let enabled = true;
const createStore = vi.fn();
const list = vi.fn<() => Promise<readonly WorkflowTemplateRecord[]>>();
const start = vi.fn();
const openTemplateLibrary = vi.fn();

vi.mock('@/platform/flags', () => ({
  isEnabled: () => enabled,
}));

vi.mock('@/features/crm-workflows', () => {
  class WorkflowTemplateError extends Error {
    readonly code: string;

    constructor(code: string, message: string) {
      super(message);
      this.code = code;
    }
  }
  return {
    openWorkflowTemplateLibrary: openTemplateLibrary,
    useWorkflowTemplateStore: () => {
      createStore();
      return { list, start };
    },
    WorkflowTemplateError,
  };
});

const published: WorkflowTemplateRecord = {
  id: 'workflow-template:published',
  name: 'Annual review',
  status: 'published',
  tagIds: [],
  steps: [],
};

const draft: WorkflowTemplateRecord = {
  id: 'workflow-template:draft',
  name: 'Planning draft',
  status: 'draft',
  tagIds: [],
  steps: [],
};

function context(
  onRequestConsumed = vi.fn()
): WorkflowRecordStartContext {
  return {
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
    onRequestConsumed,
    openTemplateLibrary: vi.fn(),
  };
}

describe('WorkflowRecordQuickAdd', () => {
  beforeEach(() => {
    enabled = true;
    vi.clearAllMocks();
    list.mockResolvedValue([published, draft]);
    start.mockResolvedValue({
      id: 'workflow-instance:one',
      templateId: published.id,
      householdId: 'household:river',
    });
  });

  it('is completely inert before the flag gate, including its descriptor', () => {
    enabled = false;
    const props = context();
    const { container } = render(<WorkflowRecordQuickAdd {...props} />);

    expect(container).toBeEmptyDOMElement();
    expect(workflowRecordQuickAddDescriptor.isEnabled?.()).toBe(false);
    expect(createStore).not.toHaveBeenCalled();
    expect(list).not.toHaveBeenCalled();
    expect(start).not.toHaveBeenCalled();
    expect(props.onRequestConsumed).not.toHaveBeenCalled();
  });

  it('lists canonical templates, locks drafts, and starts once for the bound household', async () => {
    const props = context();
    const { rerender } = render(<WorkflowRecordQuickAdd {...props} />);

    const publishedOption = await screen.findByTestId(
      `workflow-record-quickadd-template-${published.id}`
    );
    const draftOption = screen.getByTestId(
      `workflow-record-quickadd-template-${draft.id}`
    );
    expect(publishedOption.querySelector('input')).toBeChecked();
    expect(draftOption.querySelector('input')).toBeDisabled();
    expect(screen.getByText('River household', { exact: false })).toBeVisible();

    fireEvent.click(screen.getByTestId('workflow-record-quickadd-start'));

    await waitFor(() => {
      expect(start).toHaveBeenCalledWith(published.id, props.household);
      expect(props.onRequestConsumed).toHaveBeenCalledTimes(1);
    });
    rerender(<WorkflowRecordQuickAdd {...props} />);
    fireEvent.click(screen.getByTestId('workflow-record-quickadd-start'));
    expect(start).toHaveBeenCalledTimes(1);
    expect(props.onRequestConsumed).toHaveBeenCalledTimes(1);
  });

  it('consumes cancel without writing', async () => {
    const props = context();
    render(<WorkflowRecordQuickAdd {...props} />);
    await screen.findByTestId(
      `workflow-record-quickadd-template-${published.id}`
    );

    fireEvent.click(screen.getByTestId('workflow-record-quickadd-cancel'));

    expect(props.onRequestConsumed).toHaveBeenCalledTimes(1);
    expect(start).not.toHaveBeenCalled();
  });

  it('keeps a failed typed start usable and does not consume the request', async () => {
    const refusal = new (await import('@/features/crm-workflows'))
      .WorkflowTemplateError(
        'template_not_published',
        'Publish this workflow template before starting it.'
      );
    start.mockRejectedValueOnce(refusal).mockResolvedValueOnce({
      id: 'workflow-instance:retry',
      templateId: published.id,
      householdId: 'household:river',
    });
    const props = context();
    render(<WorkflowRecordQuickAdd {...props} />);
    await screen.findByTestId(
      `workflow-record-quickadd-template-${published.id}`
    );

    fireEvent.click(screen.getByTestId('workflow-record-quickadd-start'));
    expect(await screen.findByRole('alert')).toHaveTextContent(refusal.message);
    expect(props.onRequestConsumed).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('workflow-record-quickadd-start'));
    await waitFor(() => {
      expect(start).toHaveBeenCalledTimes(2);
      expect(props.onRequestConsumed).toHaveBeenCalledTimes(1);
    });
  });

  it('uses the sanctioned template-library action when no published template exists', async () => {
    list.mockResolvedValue([draft]);
    const props = context();
    render(<WorkflowRecordQuickAdd {...props} />);

    expect(
      await screen.findByTestId('workflow-record-quickadd-empty')
    ).toBeVisible();
    expect(
      screen.getByTestId(`workflow-record-quickadd-template-${draft.id}`)
        .querySelector('input')
    ).toBeDisabled();
    expect(
      screen.queryByTestId('workflow-record-quickadd-start')
    ).not.toBeInTheDocument();

    fireEvent.click(
      screen.getByTestId('workflow-record-quickadd-open-library')
    );
    expect(openTemplateLibrary).toHaveBeenCalledWith(props);
    expect(props.onRequestConsumed).not.toHaveBeenCalled();
    expect(start).not.toHaveBeenCalled();
  });
});
