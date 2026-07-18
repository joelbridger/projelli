import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi } from 'vitest';
import {
  createTemplate,
  workflowRecords,
} from '@/features/crm-home/workflowLive';
import type { LiveCrmRecord } from '@/platform/crm/liveRecords';
import { LiveWorkflows } from './Workflows';

const household = {
  id: 'household-river',
  matterId: 'matter-river',
  label: 'River household',
};

function renderWorkflows(records: readonly LiveCrmRecord[]) {
  const onSave = vi.fn<(record: LiveCrmRecord) => Promise<unknown>>((record) =>
    Promise.resolve(record)
  );
  const onNavigate = vi.fn();
  const data = workflowRecords(records);

  const view = render(
    <LiveWorkflows
      data={data}
      households={[household]}
      onSave={onSave}
      onNavigate={onNavigate}
    />
  );

  return {
    data,
    onSave,
    rerenderWithRecords: (nextRecords: readonly LiveCrmRecord[]) => {
      view.rerender(
        <LiveWorkflows
          data={workflowRecords(nextRecords)}
          households={[household]}
          onSave={onSave}
          onNavigate={onNavigate}
        />
      );
    },
  };
}

function changeRenderedTemplateStatus(
  data: ReturnType<typeof workflowRecords>,
  status: 'draft' | 'archived' | 'rejected'
) {
  const template = data.templates[0];
  if (!template) throw new Error('Expected a rendered workflow template.');
  (template as LiveCrmRecord)['status'] = status;
}

describe('workflow start gate', () => {
  it('shows why Start workflow is unavailable with zero templates', () => {
    const { onSave } = renderWorkflows([]);
    const start = screen.getByTestId('crm-live-workflow-start');

    expect(start).toBeDisabled();
    expect(start).toHaveAccessibleDescription(
      'Create a workflow template before starting a workflow.'
    );
    expect(onSave).not.toHaveBeenCalled();
  });

  it('rechecks when the published template disappears before Start runs', () => {
    const published = {
      ...createTemplate('Annual review', ['Prepare review']),
      status: 'published' as const,
    };
    const { data, onSave } = renderWorkflows([published]);
    const start = screen.getByTestId('crm-live-workflow-start');

    expect(start).toBeEnabled();
    data.templates.splice(0);
    expect(start).toBeEnabled();
    fireEvent.click(start);

    expect(onSave).not.toHaveBeenCalled();
  });

  it('shows that a draft template cannot be started', () => {
    const draft = {
      ...createTemplate('Annual review', ['Prepare review']),
      status: 'draft' as const,
    };
    const { onSave } = renderWorkflows([draft]);
    const start = screen.getByTestId('crm-live-workflow-start');

    expect(start).toBeDisabled();
    expect(start).toHaveAccessibleDescription(
      'Publish this workflow template before starting it.'
    );
    expect(onSave).not.toHaveBeenCalled();
  });

  it('rechecks a template that becomes draft before Start runs', () => {
    const published = {
      ...createTemplate('Annual review', ['Prepare review']),
      status: 'published' as const,
    };
    const { data, onSave } = renderWorkflows([published]);
    const start = screen.getByTestId('crm-live-workflow-start');

    expect(start).toBeEnabled();
    changeRenderedTemplateStatus(data, 'draft');
    expect(start).toBeEnabled();
    fireEvent.click(start);

    expect(onSave).not.toHaveBeenCalled();
  });

  it('shows that an archived template cannot be started at the live record boundary', () => {
    const archived: LiveCrmRecord = {
      ...createTemplate('Archived review', ['Prepare review']),
      status: 'archived',
    };
    const { onSave } = renderWorkflows([archived]);
    const start = screen.getByTestId('crm-live-workflow-start');

    expect(start).toBeDisabled();
    expect(start).toHaveAccessibleDescription(
      'Publish this workflow template before starting it.'
    );
    expect(onSave).not.toHaveBeenCalled();
  });

  it('rechecks a template that becomes archived before Start runs', () => {
    const published = {
      ...createTemplate('Annual review', ['Prepare review']),
      status: 'published' as const,
    };
    const { data, onSave } = renderWorkflows([published]);
    const start = screen.getByTestId('crm-live-workflow-start');

    expect(start).toBeEnabled();
    changeRenderedTemplateStatus(data, 'archived');
    expect(start).toBeEnabled();
    fireEvent.click(start);

    expect(onSave).not.toHaveBeenCalled();
  });

  it('starts a later published template when the first template is a draft', async () => {
    const draft = {
      ...createTemplate('Draft review', ['Prepare draft']),
      status: 'draft' as const,
    };
    const published = {
      ...createTemplate('Published review', ['Prepare review']),
      status: 'published' as const,
    };
    const { onSave } = renderWorkflows([draft, published]);
    const start = screen.getByTestId('crm-live-workflow-start');

    expect(start).toBeEnabled();
    fireEvent.change(screen.getByTestId('crm-live-workflow-household'), {
      target: { value: household.id },
    });
    fireEvent.click(start);

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledTimes(1);
    });
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'crm_workflow_instance',
        templateId: published.id,
        householdId: household.id,
        matterId: household.matterId,
        name: published.name,
      })
    );
  });

  it('rerenders a template that becomes rejected as unavailable', () => {
    const published = {
      ...createTemplate('Annual review', ['Prepare review']),
      status: 'published' as const,
    };
    const rejected: LiveCrmRecord = {
      ...published,
      status: 'rejected',
    };
    const { onSave, rerenderWithRecords } = renderWorkflows([published]);

    expect(screen.getByTestId('crm-live-workflow-start')).toBeEnabled();

    rerenderWithRecords([rejected]);
    const start = screen.getByTestId('crm-live-workflow-start');
    expect(start).toBeDisabled();
    expect(start).toHaveAccessibleDescription(
      'Publish this workflow template before starting it.'
    );

    expect(onSave).not.toHaveBeenCalled();
  });

  it('rechecks a template that becomes rejected before Start runs', () => {
    const published = {
      ...createTemplate('Annual review', ['Prepare review']),
      status: 'published' as const,
    };
    const { data, onSave } = renderWorkflows([published]);
    const start = screen.getByTestId('crm-live-workflow-start');

    expect(start).toBeEnabled();
    changeRenderedTemplateStatus(data, 'rejected');
    expect(start).toBeEnabled();
    fireEvent.click(start);

    expect(onSave).not.toHaveBeenCalled();
  });

  it('keeps the real published-template start callback and saves its instance', async () => {
    const published = {
      ...createTemplate('Annual review', ['Prepare review']),
      status: 'published' as const,
    };
    const { onSave } = renderWorkflows([published]);
    const start = screen.getByTestId('crm-live-workflow-start');

    expect(start).toBeEnabled();
    fireEvent.change(screen.getByTestId('crm-live-workflow-household'), {
      target: { value: household.id },
    });
    fireEvent.click(start);

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledTimes(1);
    });
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'crm_workflow_instance',
        templateId: published.id,
        householdId: household.id,
        matterId: household.matterId,
        name: published.name,
      })
    );
  });
});
