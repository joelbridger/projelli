import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TrashRecoverySurface } from './TrashRecoverySurface';

const reload = vi.fn();
const listTrashedCrmRecords = vi.fn();
const restoreTrashedCrmRecord = vi.fn();

vi.mock('@/platform/flags', () => ({ useFlag: () => true }));
vi.mock('@/platform/crm/useLiveCrmRecords', () => ({
  useLiveCrmRecords: () => ({ workspaceRoot: '/workspace', reload }),
}));
vi.mock('./trashClient', () => ({
  listTrashedCrmRecords: (...args: unknown[]) => listTrashedCrmRecords(...args),
  restoreTrashedCrmRecord: (...args: unknown[]) => restoreTrashedCrmRecord(...args),
}));

describe('TrashRecoverySurface', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listTrashedCrmRecords.mockResolvedValue([
      {
        recordId: 'household-1', recordType: 'household', matterId: 'matter-1',
        record: { name: 'Maya Chen' }, deletedAt: '2026-07-15T12:00:00Z',
        deletedBy: 'Avery Kim', expiresAt: '2099-08-14T12:00:00Z',
      },
      {
        recordId: 'task-1', recordType: 'task', matterId: 'matter-1',
        record: { title: 'Annual review' }, deletedAt: '2026-07-15T12:00:00Z',
        deletedBy: 'Avery Kim', expiresAt: '2099-08-14T12:00:00Z',
      },
    ]);
    restoreTrashedCrmRecord.mockResolvedValue({});
  });

  it('matches the Trash & recovery table: search, type filter, recovery meter, guard, and recover action', async () => {
    render(<TrashRecoverySurface />);

    await screen.findByTestId('crm-trash-row-household-1');
    expect(screen.getByTestId('crm-trash-admin-guard')).toHaveTextContent(/firm admin/i);
    expect(screen.getByTestId('crm-trash-meter-household-1')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Record' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Time remaining' })).toBeInTheDocument();

    fireEvent.change(screen.getByTestId('crm-trash-search'), { target: { value: 'annual' } });
    expect(screen.queryByTestId('crm-trash-row-household-1')).not.toBeInTheDocument();
    expect(screen.getByTestId('crm-trash-row-task-1')).toBeInTheDocument();

    fireEvent.change(screen.getByTestId('crm-trash-type-filter'), { target: { value: 'household' } });
    expect(screen.getByTestId('crm-trash-empty')).toBeInTheDocument();

    fireEvent.change(screen.getByTestId('crm-trash-search'), { target: { value: '' } });
    fireEvent.click(screen.getByTestId('crm-trash-recover-household-1'));
    await waitFor(() => expect(restoreTrashedCrmRecord).toHaveBeenCalledWith(expect.objectContaining({
      recordId: 'household-1', actorId: 'current-advisor',
    })));
    expect(reload).toHaveBeenCalled();
  });
});

