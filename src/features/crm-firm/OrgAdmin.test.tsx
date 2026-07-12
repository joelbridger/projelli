import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi } from 'vitest';
import { OrgAdmin } from './OrgAdmin';

let records: Record<string, unknown>[] = [];
const navigate = vi.fn();
let firmRole: 'admin' | null = null;
let firmClient: Record<string, ReturnType<typeof vi.fn>>;

vi.mock('@/platform/crm/useLiveCrmRecords', () => ({
  useLiveCrmRecords: () => ({ records, error: null }),
}));
vi.mock('@/features/crm-home/surfaceContext', () => ({
  useCrmHomeSurfaceContext: () => ({ navigate }),
}));
vi.mock('@/platform/hooks/useFirm', () => ({
  useFirm: () => ({ role: firmRole }),
}));
vi.mock('@/platform/firm/firmStore', () => ({
  useFirmStore: (selector: (state: { client: () => typeof firmClient }) => unknown) => selector({ client: () => firmClient }),
}));

describe('OrgAdmin', () => {
  it('teaches a first-time firm admin what this view will show', () => {
    firmRole = null;
    records = [];
    render(<OrgAdmin />);
    expect(screen.getByTestId('crm-org-admin-empty')).toHaveTextContent(/will appear here/i);
    expect(screen.getByTestId('crm-org-admin-source-notice')).toHaveTextContent(/one place/i);
    expect(screen.getByTestId('crm-org-admin-source-notice')).toHaveTextContent(/firm administration/i);
  });

  it('shows saved workspaces, member roles, access, and devices without permission controls', () => {
    firmRole = null;
    records = [
      { id: 'workspace-northcrest', kind: 'firmWorkspaceSummary', name: 'Northcrest Private Wealth', status: 'active', memberIds: ['maya'], restrictedMemberIds: ['maya'] },
      { id: 'workspace-retirement', kind: 'firmWorkspaceSummary', name: 'Retirement Services', status: 'active', memberIds: ['maya'] },
      { id: 'member-maya', kind: 'firmDirectoryEntry', userId: 'maya', displayName: 'Maya Patel', email: 'maya@example.com', title: 'Owner', active: true, workspaceIds: ['workspace-northcrest', 'workspace-retirement'] },
      { id: 'seat-maya', kind: 'firmSeatSummary', memberId: 'maya', deviceName: 'Maya’s laptop', status: 'active', lastSeenAt: '2026-07-12T12:00:00.000Z' },
    ];
    render(<OrgAdmin />);
    expect(screen.getByTestId('crm-org-admin-workspace-count')).toHaveTextContent('2');
    expect(screen.getByTestId('crm-org-admin-member-count')).toHaveTextContent('1');
    expect(screen.getByTestId('crm-org-admin-seat-count')).toHaveTextContent('1');
    expect(screen.getByTestId('crm-org-admin-workspace-workspace-northcrest')).toHaveTextContent('Northcrest Private Wealth');
    expect(screen.getByTestId('crm-org-admin-member-member-maya')).toHaveTextContent('Maya Patel');
    expect(screen.getByTestId('crm-org-admin-role-member-maya')).toHaveTextContent('Owner');
    expect(screen.getByTestId('crm-org-admin-access-member-maya')).toHaveTextContent('Northcrest Private Wealth, Retirement Services');
    expect(screen.getByTestId('crm-org-admin-seat-seat-maya')).toHaveTextContent('Maya’s laptop');
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('takes a local, restart-safe picture from the existing firm-admin rails', async () => {
    firmRole = 'admin';
    firmClient = {
      listMatters: vi.fn().mockResolvedValue({ matters: [{ matter_id: 'northcrest', client_name: 'Northcrest Advisory', status: 'active' }] }),
      listOrgUsers: vi.fn().mockResolvedValue({ users: [{ user_id: 'maya', email: 'maya@example.com', role: 'admin', status: 'active' }] }),
      listSeats: vi.fn().mockResolvedValue({ seats: [{ seat_id: 'laptop', user_id: 'maya', machine_label: 'Maya’s laptop', status: 'active', last_seen: '2026-07-12T12:00:00.000Z' }] }),
      listMatterMembers: vi.fn().mockResolvedValue({ members: [{ user_id: 'maya' }], walls: [] }),
    };
    records = [];
    save.mockClear();
    render(<OrgAdmin />);
    fireEvent.click(screen.getByTestId('crm-org-admin-refresh'));
    await Promise.resolve();
    await Promise.resolve();
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ kind: 'firmWorkspaceSummary', name: 'Northcrest Advisory' }));
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ kind: 'firmDirectoryEntry', userId: 'maya', title: 'Administrator', workspaceIds: ['northcrest'] }));
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ kind: 'firmSeatSummary', memberId: 'maya', deviceName: 'Maya’s laptop' }));
  });
});
