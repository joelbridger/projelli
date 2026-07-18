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

  const view = render(
    <LiveWorkflows
      data={workflowRecords(records)}
      households={[household]}
      onSave={onSave}
      onNavigate={onNavigate}
    />
  );

  return {
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

describe('workflow start gate', () => {
  it('shows why Start workflow is unavailable and saves nothing with zero templates', () => {
    const { onSave } = renderWorkflows([]);
    const start = screen.getByTestId('crm-live-workflow-start');

    expect(start).toBeDisabled();
    expect(start).toHaveAccessibleDescription(
      'Create a workflow template before starting a workflow.'
    );

    // Bypass the visual disable to prove the callback repeats the same guard.
    (start as HTMLButtonElement).disabled = false;
    fireEvent.click(start);

    expect(onSave).not.toHaveBeenCalled();
  });

  it('rejects a draft template through the real Start control and saves nothing', () => {
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

    (start as HTMLButtonElement).disabled = false;
    fireEvent.click(start);

    expect(onSave).not.toHaveBeenCalled();
  });

  it('keeps an archived template rejected if one reaches the live record boundary', () => {
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

    (start as HTMLButtonElement).disabled = false;
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

  it('rechecks a published template that becomes rejected before Start runs', () => {
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

    // Bypass the disabled DOM state to exercise the canonical click handler.
    (start as HTMLButtonElement).disabled = false;
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
