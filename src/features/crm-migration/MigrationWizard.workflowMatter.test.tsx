import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MigrationWizard } from './MigrationWizard';

const save = vi.fn();
const reload = vi.fn();

vi.mock('@/platform/crm/useLiveCrmRecords', () => ({
  LIVE_CRM_RECORDS_CHANGED: 'crm-records-changed',
  useLiveCrmRecords: () => ({
    records: [
      {
        id: 'household-1',
        kind: 'household',
        matterId: 'matter-1',
        name: 'River household',
      },
      {
        id: 'checklist-1',
        kind: 'migration_workflow_checklist',
        matterId: 'firm_home',
        householdId: 'household-1',
        clientLabel: 'River household',
        sourceTemplateLabel: 'Annual review',
        availableSteps: ['Prepare', 'Meet'],
      },
      {
        id: 'household-2',
        kind: 'household',
        matterId: 'firm',
        name: 'Imported household',
      },
      {
        id: 'checklist-2',
        kind: 'migration_workflow_checklist',
        matterId: 'firm',
        householdId: 'household-2',
        clientLabel: 'Imported household',
        sourceTemplateLabel: 'Imported review',
        availableSteps: ['Collect', 'Review'],
      },
    ],
    save,
    reload,
    freshness: { kind: 'live' },
  }),
}));

vi.mock('@/features/crm-home/surfaceContext', () => ({
  useCrmHomeSurfaceContext: () => ({
    adapterProvided: false,
    adapter: { freshness: { kind: 'live' } },
    navigate: vi.fn(),
    route: { kind: 'migration' },
  }),
}));

describe('migration workflow matter ownership', () => {
  beforeEach(() => {
    save.mockReset();
    save.mockImplementation((record: unknown) => Promise.resolve(record));
    reload.mockReset();
    reload.mockResolvedValue(undefined);
  });

  it('recreates an imported workflow in the household client matter', async () => {
    render(<MigrationWizard />);

    fireEvent.click(screen.getByTestId('crm-migration-fidelity'));
    fireEvent.click(screen.getByTestId('crm-migration-workflow-fallback'));
    fireEvent.change(screen.getByTestId('crm-workflow-step-checklist-1'), {
      target: { value: 'Prepare' },
    });
    fireEvent.change(screen.getByTestId('crm-workflow-instance-checklist-1'), {
      target: { value: 'Imported annual review' },
    });
    fireEvent.click(screen.getByTestId('crm-workflow-record-checklist-1'));

    await waitFor(() => {
      expect(save).toHaveBeenCalledWith(expect.objectContaining({
        kind: 'crm_workflow_instance',
        householdId: 'household-1',
        matterId: 'matter-1',
      }));
    });
  });

  it('does not mistake the importer firm placeholder for a client matter', async () => {
    render(<MigrationWizard />);

    fireEvent.click(screen.getByTestId('crm-migration-fidelity'));
    fireEvent.click(screen.getByTestId('crm-migration-workflow-fallback'));
    fireEvent.change(screen.getByTestId('crm-workflow-step-checklist-2'), {
      target: { value: 'Collect' },
    });
    fireEvent.change(screen.getByTestId('crm-workflow-instance-checklist-2'), {
      target: { value: 'Imported client review' },
    });
    fireEvent.click(screen.getByTestId('crm-workflow-record-checklist-2'));

    await waitFor(() => {
      expect(save).toHaveBeenCalledWith(expect.objectContaining({
        kind: 'crm_workflow_instance',
        householdId: 'household-2',
        matterId: 'household-2',
      }));
    });
  });
});
