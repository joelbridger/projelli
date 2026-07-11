import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { parseMatterHandle, parseStreamHandle } from '@/platform/firm/contract';

const matterHandle = parseMatterHandle(`mh2_${'A'.repeat(43)}`);
const rootStreamHandle = parseStreamHandle(`sh2_${'B'.repeat(43)}`);
const testState = vi.hoisted(() => {
  const mocks = {
    publishMatterKeyToMembers: vi.fn(),
    keyRelease: 'release_to_member' as 'release_to_member' | 'blocked_walled',
  };
  const client = {
    listMatters: vi.fn(() => Promise.resolve({
      matters: [{
      matter_handle: `mh2_${'A'.repeat(43)}`,
      root_stream_handle: `sh2_${'B'.repeat(43)}`,
      status: 'active' as const,
      key_epoch: 1,
      // A malicious or stale server response must never become a client label.
      client_name: 'CLIENT_SECRET_NIMBUS',
      matter_id: 'matter-semantic-123',
      doc_id: 'doc-advisory-plan.docx',
      name: 'Client plan.docx',
      displayName: '/clients/nimbus',
    }],
    })),
    listSeats: vi.fn(() => Promise.resolve({ seats: [] })),
    listProviderKeys: vi.fn(() => Promise.resolve({ keys: [] })),
    listOrgUsers: vi.fn(() => Promise.resolve({ users: [] })),
    ssoConfigGet: vi.fn(() => Promise.resolve({ configured: false, redirect_uri: 'https://example.test/callback' })),
    listMatterMembers: vi.fn(() => Promise.resolve({ key_epoch: 1, members: [], walls: [] })),
    createUser: vi.fn(() => Promise.resolve({ user: { user_id: 'new-member' } })),
    addMatterMember: vi.fn(() => Promise.resolve({ ok: true, role: 'editor', key_epoch: 1, key_release: mocks.keyRelease })),
  };
  return { client, getClient: () => client, mocks };
});
const { client, mocks } = testState;

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/platform/hooks/useFirm', () => ({ useFirm: () => ({ isSignedIn: true, role: 'admin' }) }));
vi.mock('@/platform/firm/firmStore', () => ({
  useFirmStore: <T,>(selector: (state: { client: () => typeof testState.client; refreshAssuredProviders: () => void }) => T) => selector({
    client: testState.getClient,
    refreshAssuredProviders: () => undefined,
  }),
}));
vi.mock('@/platform/firm/matterKeyService', () => ({
  publishMatterKeyToMembers: testState.mocks.publishMatterKeyToMembers,
  autoRepublishHeldMatterKeys: vi.fn(() => Promise.resolve({ fingerprints: {}, republishedMatterIds: [] })),
}));
vi.mock('@/platform/audit/AuditService', () => ({ AuditService: class { append = vi.fn(); } }));

import { FirmAdminConsole } from './FirmAdminConsole';

describe('FirmAdminConsole opaque client labels', () => {
  it('renders only a generic shared-client label, never a server-supplied name or routing value', async () => {
    render(<FirmAdminConsole />);

    await waitFor(() => { expect(screen.getByTestId(`firm-matter-${matterHandle}`)).toBeTruthy(); });

    const list = screen.getByTestId('firm-matter-list');
    expect(list.textContent).toContain('Shared client');
    for (const forbidden of [
      'CLIENT_SECRET_NIMBUS',
      'matter-semantic-123',
      'local-matter-77',
      'doc-advisory-plan.docx',
      'Client plan.docx',
      '/clients/nimbus',
    ]) expect(screen.queryByText(forbidden, { exact: false })).toBeNull();
  });

  it('publishes an invited member key only when the server releases it', async () => {
    mocks.publishMatterKeyToMembers.mockReset();
    mocks.keyRelease = 'release_to_member';
    render(<FirmAdminConsole />);

    await screen.findByTestId(`firm-matter-${matterHandle}`);
    fireEvent.click(screen.getByTestId(`firm-matter-${matterHandle}`));
    fireEvent.change(await screen.findByTestId('firm-member-email'), { target: { value: 'release@firm.test' } });
    fireEvent.click(screen.getByTestId('firm-add-member'));
    await waitFor(() => expect(mocks.publishMatterKeyToMembers).toHaveBeenCalledWith(client, matterHandle, 1));

    mocks.publishMatterKeyToMembers.mockClear();
    mocks.keyRelease = 'blocked_walled';
    fireEvent.change(screen.getByTestId('firm-member-email'), { target: { value: 'walled@firm.test' } });
    fireEvent.click(screen.getByTestId('firm-add-member'));
    await waitFor(() => expect(client.addMatterMember).toHaveBeenCalledTimes(2));
    expect(mocks.publishMatterKeyToMembers).not.toHaveBeenCalled();
  });
});
