import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { LiveCrmRecord } from '@/platform/crm/liveRecords';
import { CrmViewsSurface } from './CrmViewsSurface';
import { applyViewQuery, defaultViewQuery } from './viewQuery';

const save = vi.fn(async (record: LiveCrmRecord) => record);
let records: readonly LiveCrmRecord[] = [];

vi.mock('@/platform/crm/useLiveCrmRecords', () => ({
  useLiveCrmRecords: () => ({
    records,
    save,
    error: null,
    sharedMatterId: 'firm-home',
  }),
}));

describe('saved CRM views', () => {
  it('filters and sorts only with the bounded saved-view language', () => {
    const query = {
      ...defaultViewQuery('tasks'),
      filters: [{ field: 'status', op: 'eq' as const, value: 'open' }],
      sort: [{ field: 'title', dir: 'desc' as const }],
    };
    expect(
      applyViewQuery(
        [
          { id: '1', kind: 'task', title: 'Call', status: 'open' },
          { id: '2', kind: 'task', title: 'Archive', status: 'done' },
          { id: '3', kind: 'task', title: 'Review', status: 'open' },
        ],
        query
      ).map((record) => record.id)
    ).toEqual(['3', '1']);
  });

  it('builds a firm board and saves its query through the live record bridge', async () => {
    save.mockClear();
    records = [
      {
        id: 'task-1',
        kind: 'task',
        title: 'Call Avery',
        status: 'open',
        priority: 'high',
      },
      {
        id: 'task-2',
        kind: 'task',
        title: 'Prepare review',
        status: 'done',
        priority: 'normal',
      },
    ];
    render(<CrmViewsSurface />);
    fireEvent.change(screen.getByTestId('crm-views-layout'), {
      target: { value: 'kanban' },
    });
    expect(screen.getByTestId('crm-views-board')).toHaveTextContent(
      'Call Avery'
    );
    fireEvent.click(screen.getByTestId('crm-views-add-filter'));
    fireEvent.change(screen.getByTestId('crm-views-filter-field-0'), {
      target: { value: 'status' },
    });
    fireEvent.change(screen.getByTestId('crm-views-filter-op-0'), {
      target: { value: 'eq' },
    });
    fireEvent.change(screen.getByTestId('crm-views-filter-value-0'), {
      target: { value: 'open' },
    });
    expect(screen.queryByText('Prepare review')).not.toBeInTheDocument();
    fireEvent.change(screen.getByTestId('crm-views-name'), {
      target: { value: 'Open work' },
    });
    fireEvent.change(screen.getByTestId('crm-views-visibility'), {
      target: { value: 'firm' },
    });
    fireEvent.click(screen.getByTestId('crm-views-save-button'));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'savedView',
        name: 'Open work',
        surface: 'tasks',
        visibility: 'firm',
        layout: 'kanban',
        query: expect.objectContaining({
          filters: [{ field: 'status', op: 'eq', value: 'open' }],
        }),
      })
    );
  });

  it('opens a saved household list with its saved fields', () => {
    records = [
      {
        id: 'household-1',
        kind: 'household',
        name: 'Henderson household',
        serviceTier: 'Gold',
        lifecycle: 'Active',
      },
      {
        id: 'view-1',
        kind: 'savedView',
        name: 'Gold households',
        surface: 'households',
        visibility: 'personal',
        layout: 'list',
        query: {
          entity: 'household',
          filters: [{ field: 'serviceTier', op: 'eq', value: 'Gold' }],
          fields: ['name', 'serviceTier'],
        },
      },
    ];
    render(<CrmViewsSurface />);
    fireEvent.change(screen.getByTestId('crm-views-entity'), {
      target: { value: 'households' },
    });
    fireEvent.click(screen.getByTestId('crm-views-open-view-1'));
    expect(screen.getByTestId('crm-views-list')).toHaveTextContent(
      'Henderson household'
    );
    expect(screen.getByTestId('crm-views-list')).toHaveTextContent('Gold');
  });
});
