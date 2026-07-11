import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { parseMatterHandle, parseStreamHandle } from '@/platform/firm/contract';

const matterHandle = parseMatterHandle(`mh2_${'A'.repeat(43)}`);
const rootStreamHandle = parseStreamHandle(`sh2_${'B'.repeat(43)}`);

const client = {
  listMatters: vi.fn(() => Promise.resolve({
    matters: [{
      matter_handle: matterHandle,
      root_stream_handle: rootStreamHandle,
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
};

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/platform/hooks/useFirm', () => ({ useFirm: () => ({ isSignedIn: true, role: 'admin' }) }));
vi.mock('@/platform/firm/firmStore', () => ({
  useFirmStore: <T,>(selector: (state: { client: () => typeof client; refreshAssuredProviders: () => void }) => T) => selector({
    client: () => client,
    refreshAssuredProviders: () => undefined,
  }),
}));
vi.mock('@/platform/firm/matterKeyService', () => ({
  publishMatterKeyToMembers: vi.fn(),
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
});
