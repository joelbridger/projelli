/**
 * Client Map hub navigation (newNav) — Wave 1 shell/routing hardening.
 *
 * In the 3-tab IA the Client Map surface shows the all-clients OVERVIEW table
 * when no client's hub is open, and the per-client MatterHub (hero view) when
 * one is. The hub-open state is the store's ephemeral `clientMapHubId` so it
 * survives the MattersHome unmount/remount a surface switch causes: drilling
 * into a client's Documents/Email and returning to Client Map lands back on
 * that client's hub, not the overview.
 *
 * The hub is honored only when clientMapHubId === activeMatterId, so a stale id
 * from a client switch falls back to the overview (never the wrong client).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useMatterStore } from '@/platform/matter/matterStore';
import { useProfessionStore } from '@/platform/profile/professionStore';

// Stub the heavy MatterHub — we only assert routing (which view renders).
vi.mock('@/features/matters/MatterHub', () => ({
  MatterHub: ({ matterId, onBack }: { matterId: string; onBack: () => void }) => (
    <div data-testid="mock-matter-hub" data-matter-id={matterId}>
      <button data-testid="mock-hub-back" onClick={onBack}>back</button>
    </div>
  ),
}));

// MattersHome's transitive deps (mirrors reimaginedMattersHome.test.tsx).
vi.mock('@/platform/utils/mail-commands', () => ({
  mailListMessages: async () => ({ items: [], total: 0 }),
  mailIsConnected: async () => false,
  gmailIsConnected: async () => false,
  mailImapIsConnected: async () => false,
  mailConnectedAccounts: async () => [],
  mailClearMatterFilings: async () => 0,
}));
vi.mock('@/platform/hooks/useApiKeys', () => ({ useApiKeys: () => ({ apiKeys: [] }) }));
vi.mock('@/platform/hooks/useFirm', () => ({
  useFirm: () => ({
    isSignedIn: false, hasActiveSeat: false, role: null, org: null, email: null,
    seatId: null, entitlement: { aiEnabled: false }, isOffline: false, isLoading: false,
    error: null, assuredProviders: [],
    signIn: async () => ({ ok: true }), activateSeat: async () => ({ ok: true }),
    signOut: async () => undefined,
  }),
  useAssuredAvailable: () => false,
}));
vi.mock('@/platform/fs/workspaceStore', () => ({
  useWorkspaceStore: (sel: (s: { rootPath: string | null; fileTree: unknown[] }) => unknown) =>
    sel({ rootPath: null, fileTree: [] }),
}));
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(async () => { throw new Error('not in test'); }),
  isTauri: () => false,
}));
vi.mock('@/platform/audit/AuditService', () => ({
  AuditService: class { append() {} },
  isAuditEncrypted: () => false,
}));
vi.mock('@/platform/firm/matterKeyService', () => ({
  getOrCreateMatterKey: async () => 'key',
  publishMatterKeyToMembers: async () => ({ published: 0, skippedWalled: 0 }),
  obtainMatterKey: async () => null,
}));
vi.mock('@/platform/firm/deviceKeys', () => ({
  registerDevice: async () => undefined,
  _resetDeviceCache: () => undefined,
  getOrCreateDeviceKeypair: async () => ({ deviceId: 'test', publicJwk: {} }),
}));

import { MattersHome } from '@/features/matters/MattersHome';

function seedMatter(name = 'Acme Household'): string {
  useMatterStore.getState().createMatter({ name, client: name });
  return useMatterStore.getState().matters.find((m) => m.client === name)!.id;
}

beforeEach(() => {
  useMatterStore.setState({ matters: [], activeMatterId: null, clientMapHubId: null });
  useProfessionStore.setState({ profession: 'advisor' });
});

describe('matterStore — clientMapHubId (ephemeral hub-nav slice)', () => {
  it('defaults to null and round-trips through setClientMapHubId', () => {
    expect(useMatterStore.getState().clientMapHubId).toBeNull();
    useMatterStore.getState().setClientMapHubId('matter_x');
    expect(useMatterStore.getState().clientMapHubId).toBe('matter_x');
    useMatterStore.getState().setClientMapHubId(null);
    expect(useMatterStore.getState().clientMapHubId).toBeNull();
  });

  // Codex review (P2): a hub must NOT resurrect after switching the active
  // client away and back via the rail switcher.
  it('clears the hub when the active client changes away (no resurrection on switch-back)', () => {
    const a = seedMatter('Alpha');
    const b = seedMatter('Beta');
    useMatterStore.getState().setActiveMatter(a);
    useMatterStore.getState().setClientMapHubId(a);
    expect(useMatterStore.getState().clientMapHubId).toBe(a);
    // Rail switch to B → A's hub clears.
    useMatterStore.getState().setActiveMatter(b);
    expect(useMatterStore.getState().clientMapHubId).toBeNull();
    // Rail switch back to A → hub must stay closed (not resurrect).
    useMatterStore.getState().setActiveMatter(a);
    expect(useMatterStore.getState().clientMapHubId).toBeNull();
  });

  it('keeps the hub open when the SAME active client is re-set (back-nav drill-in)', () => {
    const a = seedMatter('Alpha');
    useMatterStore.getState().setActiveMatter(a);
    useMatterStore.getState().setClientMapHubId(a);
    // A matter-launch into the client's Documents re-sets the same active id.
    useMatterStore.getState().setActiveMatter(a);
    expect(useMatterStore.getState().clientMapHubId).toBe(a);
  });

  it('clears the hub when its matter is archived or deleted', () => {
    const a = seedMatter('Alpha');
    useMatterStore.getState().setActiveMatter(a);
    useMatterStore.getState().setClientMapHubId(a);
    useMatterStore.getState().setMatterArchived(a, true);
    expect(useMatterStore.getState().clientMapHubId).toBeNull();

    const b = seedMatter('Beta');
    useMatterStore.getState().setActiveMatter(b);
    useMatterStore.getState().setClientMapHubId(b);
    useMatterStore.getState().deleteMatter(b);
    expect(useMatterStore.getState().clientMapHubId).toBeNull();
  });
});

describe('Client Map hub navigation', () => {
  it('shows the All Clients table when the tab is clicked with no selected client', () => {
    const id = seedMatter();
    render(<MattersHome clientMapMode="client-map" />);

    expect(screen.getByTestId(`matter-row-${id}`)).toBeInTheDocument();
    expect(screen.queryByTestId('mock-matter-hub')).not.toBeInTheDocument();
  });

  it('still shows the practice-wide table when the All Clients rail entry chooses it', () => {
    const id = seedMatter();
    render(<MattersHome clientMapMode="all-clients" />);

    expect(screen.getByTestId(`matter-row-${id}`)).toBeInTheDocument();
  });

  it('keeps the All Clients table visible even if a client hub id is still remembered', () => {
    const id = seedMatter();
    useMatterStore.getState().setActiveMatter(id);
    useMatterStore.getState().setClientMapHubId(id);

    render(<MattersHome clientMapMode="all-clients" />);

    expect(screen.getByTestId(`matter-row-${id}`)).toBeInTheDocument();
    expect(screen.queryByTestId('mock-matter-hub')).not.toBeInTheDocument();
  });

  it('shows the OVERVIEW table when no hub is open', () => {
    const id = seedMatter();
    render(<MattersHome clientMapMode="all-clients" />);
    expect(screen.getByTestId(`matter-row-${id}`)).toBeInTheDocument();
    expect(screen.queryByTestId('mock-matter-hub')).not.toBeInTheDocument();
  });

  it('shows the per-client HUB when clientMapHubId === activeMatterId (the back-nav case)', () => {
    const id = seedMatter();
    useMatterStore.getState().setActiveMatter(id);
    useMatterStore.getState().setClientMapHubId(id);
    render(<MattersHome />);
    const hub = screen.getByTestId('mock-matter-hub');
    expect(hub).toBeInTheDocument();
    expect(hub.getAttribute('data-matter-id')).toBe(id);
    expect(screen.queryByTestId(`matter-row-${id}`)).not.toBeInTheDocument();
  });

  it('falls back to the OVERVIEW when clientMapHubId is stale (!== activeMatterId)', () => {
    const id = seedMatter();
    useMatterStore.getState().setActiveMatter(id);
    // A leftover id from a previous client — must not show the wrong hub.
    useMatterStore.getState().setClientMapHubId('matter_other_stale');
    render(<MattersHome />);
    expect(screen.getByTestId(`matter-row-${id}`)).toBeInTheDocument();
    expect(screen.queryByTestId('mock-matter-hub')).not.toBeInTheDocument();
  });

  it('clicking a client row opens that client\'s hub via the store', async () => {
    const id = seedMatter();
    render(<MattersHome />);
    fireEvent.click(screen.getByTestId(`matter-row-${id}`));
    await vi.waitFor(() => {
      expect(useMatterStore.getState().clientMapHubId).toBe(id);
      expect(useMatterStore.getState().activeMatterId).toBe(id);
      expect(screen.getByTestId('mock-matter-hub')).toBeInTheDocument();
    });
  });

  it('hub "back" clears clientMapHubId and returns to the overview', () => {
    const id = seedMatter();
    useMatterStore.getState().setActiveMatter(id);
    useMatterStore.getState().setClientMapHubId(id);
    render(<MattersHome />);
    fireEvent.click(screen.getByTestId('mock-hub-back'));
    expect(useMatterStore.getState().clientMapHubId).toBeNull();
    expect(screen.getByTestId(`matter-row-${id}`)).toBeInTheDocument();
  });
});
