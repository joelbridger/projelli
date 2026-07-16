import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TrashRecoverySurface } from './TrashRecoverySurface';
import type { TrashedCrmRecord } from './trashClient';

const { reload, useFirmStore, useFlag, useLiveCrmRecords } = vi.hoisted(() => ({
  reload: vi.fn(),
  useFirmStore: vi.fn(
    (selector: (state: { session: { userId: string } }) => unknown) =>
      selector({ session: { userId: 'advisor-9' } })
  ),
  useFlag: vi.fn<(flagId: string) => boolean>(() => true),
  useLiveCrmRecords: vi.fn(() => ({
    workspaceRoot: '/workspace',
    reload,
  })),
}));
const listTrashedCrmRecords = vi.fn<
  (workspaceRoot: string) => Promise<readonly TrashedCrmRecord[]>
>();
const restoreTrashedCrmRecord = vi.fn<
  (request: unknown) => Promise<unknown>
>();

vi.mock('@/platform/flags', () => ({ useFlag }));
vi.mock('@/platform/crm/useLiveCrmRecords', () => ({
  useLiveCrmRecords,
}));
vi.mock('@/platform/firm/firmStore', () => ({ useFirmStore }));
vi.mock('./trashClient', () => ({
  listTrashedCrmRecords: (workspaceRoot: string) =>
    listTrashedCrmRecords(workspaceRoot),
  restoreTrashedCrmRecord: (request: unknown) =>
    restoreTrashedCrmRecord(request),
}));

describe('TrashRecoverySurface', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useFlag.mockReturnValue(true);
    listTrashedCrmRecords.mockResolvedValue([
      {
        recordId: 'household-1',
        recordType: 'household',
        matterId: 'matter-1',
        record: { name: 'Maya Chen' },
        deletedAt: '2026-07-15T12:00:00Z',
        deletedBy: 'Avery Kim',
        expiresAt: '2099-08-14T12:00:00Z',
      },
      {
        recordId: 'task-1',
        recordType: 'task',
        matterId: 'matter-1',
        record: { title: 'Annual review' },
        deletedAt: '2026-07-15T12:00:00Z',
        deletedBy: 'Avery Kim',
        expiresAt: '2099-08-14T12:00:00Z',
      },
    ]);
    restoreTrashedCrmRecord.mockResolvedValue({});
  });

  it('only mounts CRM and trash data loaders while the feature is enabled', async () => {
    useFlag.mockReturnValue(false);

    const { container, rerender } = render(<TrashRecoverySurface />);

    expect(container).toBeEmptyDOMElement();
    expect(useLiveCrmRecords).not.toHaveBeenCalled();
    expect(useFirmStore).not.toHaveBeenCalled();
    expect(listTrashedCrmRecords).not.toHaveBeenCalled();

    useFlag.mockReturnValue(true);
    listTrashedCrmRecords.mockImplementation(() => new Promise(() => {}));
    rerender(<TrashRecoverySurface />);

    await waitFor(() => {
      expect(listTrashedCrmRecords).toHaveBeenCalledOnce();
    });
    expect(useLiveCrmRecords).toHaveBeenCalledTimes(1);
    expect(useFirmStore).toHaveBeenCalledTimes(1);
  });

  it('matches the Trash & recovery table: search, type filter, recovery meter, guard, and recover action', async () => {
    render(<TrashRecoverySurface />);

    await screen.findByTestId('crm-trash-row-matter-1--household-1');
    expect(screen.getByTestId('crm-trash-admin-guard')).toHaveTextContent(
      /firm admin/i
    );
    expect(
      screen.getByTestId('crm-trash-meter-matter-1--household-1')
    ).toBeInTheDocument();
    expect(
      screen.getByRole('columnheader', { name: 'Record' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('columnheader', { name: 'Time remaining' })
    ).toBeInTheDocument();
    expect(screen.getByTestId('crm-trash-card')).toHaveClass('kp-card');
    expect(screen.getByTestId('crm-trash-search')).toHaveAttribute(
      'placeholder',
      'Search deleted records'
    );
    expect(screen.getByTestId('crm-trash-type-filter')).toHaveTextContent(
      'All types · 2'
    );

    fireEvent.change(screen.getByTestId('crm-trash-search'), {
      target: { value: 'annual' },
    });
    expect(
      screen.queryByTestId('crm-trash-row-matter-1--household-1')
    ).not.toBeInTheDocument();
    expect(screen.getByTestId('crm-trash-row-matter-1--task-1')).toBeInTheDocument();

    fireEvent.change(screen.getByTestId('crm-trash-type-filter'), {
      target: { value: 'household' },
    });
    expect(screen.getByTestId('crm-trash-empty')).toBeInTheDocument();

    fireEvent.change(screen.getByTestId('crm-trash-search'), {
      target: { value: '' },
    });
    fireEvent.click(
      screen.getByTestId('crm-trash-recover-matter-1--household-1')
    );
    await waitFor(() => {
      expect(restoreTrashedCrmRecord).toHaveBeenCalledWith(
        expect.objectContaining({
          recordId: 'household-1',
          actorId: 'advisor-9',
          matterId: 'matter-1',
        })
      );
    });
    expect(reload).toHaveBeenCalled();
  });

  it('keeps equal record IDs in different matters independent', async () => {
    listTrashedCrmRecords.mockResolvedValue([
      {
        recordId: 'shared-id',
        recordType: 'household',
        matterId: 'matter-a',
        record: { name: 'First household' },
        deletedAt: '2026-07-15T12:00:00Z',
        deletedBy: 'Avery Kim',
        expiresAt: '2099-08-14T12:00:00Z',
      },
      {
        recordId: 'shared-id',
        recordType: 'household',
        matterId: 'matter-b',
        record: { name: 'Second household' },
        deletedAt: '2026-07-15T12:00:00Z',
        deletedBy: 'Avery Kim',
        expiresAt: '2099-08-14T12:00:00Z',
      },
    ]);

    render(<TrashRecoverySurface />);

    await screen.findByTestId('crm-trash-row-matter-a--shared-id');
    expect(
      screen.getByTestId('crm-trash-row-matter-b--shared-id')
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByTestId('crm-trash-recover-matter-a--shared-id')
    );
    await waitFor(() => {
      expect(restoreTrashedCrmRecord).toHaveBeenCalledWith(
        expect.objectContaining({ matterId: 'matter-a', recordId: 'shared-id' })
      );
    });
    expect(
      screen.getByTestId('crm-trash-recover-matter-b--shared-id')
    ).not.toBeDisabled();
  });
});
