import { render, screen, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EV_OPEN_CRM } from '@/config/identity';
import { useWorkspaceStore } from '@/platform/fs/workspaceStore';
import { CrmSourcePanel } from './CrmSourcePanel';
import { loadLiveCrmRecords } from '@/platform/crm/liveRecords';

vi.mock('@/platform/crm/liveRecords', () => ({
  loadLiveCrmRecords: vi.fn(),
}));

const loadMock = vi.mocked(loadLiveCrmRecords);

function dispatchOpenCrm(detail: Record<string, unknown>): void {
  act(() => {
    window.dispatchEvent(new CustomEvent(EV_OPEN_CRM, { detail }));
  });
}

beforeEach(() => {
  useWorkspaceStore.setState({ rootPath: '/ws' });
  loadMock.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('CrmSourcePanel — right file, wrong client (Ask-seam defect #2)', () => {
  it('never opens a same-id CRM record belonging to another client', async () => {
    // Two clients each own a record with the SAME id `note-1`.
    loadMock.mockResolvedValue([
      { id: 'note-1', kind: 'note', matterId: 'client-b', body: 'Wrong client' },
      { id: 'note-1', kind: 'note', matterId: 'client-a', body: 'Correct client' },
    ]);

    render(<CrmSourcePanel />);
    dispatchOpenCrm({
      sourceId: 'crm:note:note-1',
      matterId: 'client-a',
      entityKind: 'note',
    });

    const record = await screen.findByTestId('crm-citation-record');
    expect(record).toHaveTextContent('Correct client');
    expect(record).not.toHaveTextContent('Wrong client');
  });

  it('fails closed when the record kind does not match (would open the wrong entity)', async () => {
    // A note and a task can collide on id across entity kinds. The citation is
    // for a note; a same-id task must never be opened in its place.
    loadMock.mockResolvedValue([
      { id: 'shared-1', kind: 'task', matterId: 'client-a', body: 'A task, not the cited note' },
    ]);

    render(<CrmSourcePanel />);
    dispatchOpenCrm({
      sourceId: 'crm:note:shared-1',
      matterId: 'client-a',
      entityKind: 'note',
    });

    expect(
      await screen.findByText(/not available to this seat/i),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('crm-citation-record')).toBeNull();
  });

  it('fails closed when the event carries no client identity (legacy shape)', async () => {
    loadMock.mockResolvedValue([
      { id: 'note-1', kind: 'note', matterId: 'client-a', body: 'Correct client' },
    ]);

    render(<CrmSourcePanel />);
    // A legacy event with only { sourceId } cannot prove which client this is.
    dispatchOpenCrm({ sourceId: 'crm:note:note-1' });

    expect(
      await screen.findByText(/not available to this seat/i),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('crm-citation-record')).toBeNull();
  });
});
