/**
 * matterHub.test.tsx
 *
 * Tests for MatterHub component + the list<->hub wiring in MattersHome.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useMatterStore, SAMPLE_MATTER_ID } from '@/platform/matter/matterStore';

// ── Mail commands (async probes used by GetStartedCard) ───────────────────────
vi.mock('@/platform/utils/mail-commands', () => ({
  mailListMessages: async () => ({ items: [], total: 0 }),
  mailIsConnected: async () => false,
  gmailIsConnected: async () => false,
  mailImapIsConnected: async () => false,
  mailConnectedAccounts: async () => [],
}));

// ── useApiKeys ─────────────────────────────────────────────────────────────────
vi.mock('@/platform/hooks/useApiKeys', () => ({
  useApiKeys: () => ({ apiKeys: [] }),
}));

// ── useFirm (no firm session in these tests) ──────────────────────────────────
vi.mock('@/platform/hooks/useFirm', () => ({
  useFirm: () => ({
    isSignedIn: false,
    hasActiveSeat: false,
    role: null,
    org: null,
    email: null,
    seatId: null,
    entitlement: { aiEnabled: false },
    isOffline: false,
    isLoading: false,
    error: null,
    assuredProviders: [],
    signIn: async () => ({ ok: true }),
    activateSeat: async () => ({ ok: true }),
    signOut: async () => undefined,
  }),
  useAssuredAvailable: () => false,
}));

// ── Workspace store (empty tree) ───────────────────────────────────────────────
vi.mock('@/platform/fs/workspaceStore', () => ({
  useWorkspaceStore: (sel: (s: { rootPath: string | null; fileTree: unknown[] }) => unknown) =>
    sel({ rootPath: null, fileTree: [] }),
}));

// ── Tauri keychain (firm module deps) ─────────────────────────────────────────
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(async () => { throw new Error('not in test'); }),
  isTauri: () => false,
}));

// ── AuditService ───────────────────────────────────────────────────────────────
vi.mock('@/platform/audit/AuditService', () => ({
  AuditService: class { append() {} },
  isAuditEncrypted: () => false,
}));

// ── firm key service ───────────────────────────────────────────────────────────
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

vi.mock('@/platform/providers/fetchUtils', () => ({
  getCorsSafeFetch: async () => vi.fn(),
}));

// ── AI Chat Store ──────────────────────────────────────────────────────────────
vi.mock('@/platform/state/aiChatStore', () => ({
  useAIChatStore: (sel: (s: { sessions: Record<string, unknown> }) => unknown) =>
    sel({ sessions: {} }),
}));

// ── Import components after mocks ──────────────────────────────────────────────
import { MattersHome } from '@/features/matters/MattersHome';
import { MatterHub } from '@/features/matters/MatterHub';

function resetStore() {
  useMatterStore.setState({ matters: [], activeMatterId: null });
}

// ─────────────────────────────────────────────────────────────────────────────
// Hub wiring — list<->hub navigation
// ─────────────────────────────────────────────────────────────────────────────

describe('MatterHub — list to hub navigation', () => {
  beforeEach(resetStore);

  it('clicking a matter row opens the hub', () => {
    useMatterStore.getState().createMatter({ name: 'Acme v. Beta', client: 'Acme' });
    const matter = useMatterStore.getState().matters[0]!;

    render(<MattersHome />);

    fireEvent.click(screen.getByTestId(`matter-row-${matter.id}`));

    expect(screen.getByTestId('hub-back-btn')).toBeInTheDocument();
  });

  it('hub header shows matter name', () => {
    useMatterStore.getState().createMatter({ name: 'Smith Estate', client: 'Jane Smith' });
    const matter = useMatterStore.getState().matters[0]!;

    render(<MatterHub matterId={matter.id} onBack={() => undefined} />);

    // matterLabel returns "Jane Smith - Smith Estate" when both name + client are set
    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading.textContent).toContain('Smith Estate');
  });

  it('hub shows Isolated badge when matter is privileged', () => {
    useMatterStore.getState().createMatter({
      name: 'Confidential Matter',
      client: 'Client A',
      privileged: true,
    });
    const matter = useMatterStore.getState().matters[0]!;
    // Set active matter so useActiveMatterPrivileged returns true
    useMatterStore.getState().setActiveMatter(matter.id);

    render(<MatterHub matterId={matter.id} onBack={() => undefined} />);

    expect(screen.getByTestId('hub-isolated-badge')).toBeInTheDocument();
  });

  it('hub does NOT show Isolated badge when matter is not privileged', () => {
    useMatterStore.getState().createMatter({ name: 'Normal Matter', client: 'Client B' });
    const matter = useMatterStore.getState().matters[0]!;

    render(<MatterHub matterId={matter.id} onBack={() => undefined} />);

    expect(screen.queryByTestId('hub-isolated-badge')).toBeNull();
  });

  it('back button returns to matter list', () => {
    useMatterStore.getState().createMatter({ name: 'Back Test', client: 'Client' });
    const matter = useMatterStore.getState().matters[0]!;

    render(<MattersHome />);

    // Open the hub
    fireEvent.click(screen.getByTestId(`matter-row-${matter.id}`));
    expect(screen.getByTestId('hub-back-btn')).toBeInTheDocument();

    // Click back
    fireEvent.click(screen.getByTestId('hub-back-btn'));

    // Hub should be gone, list visible again
    expect(screen.queryByTestId('hub-back-btn')).not.toBeInTheDocument();
    expect(screen.getByTestId(`matter-row-${matter.id}`)).toBeInTheDocument();
  });

  it('sample matter leads with the Client Map (no separate curated glance)', () => {
    useMatterStore.setState({
      matters: [
        {
          id: SAMPLE_MATTER_ID,
          name: 'Garcia v. Meridian Properties LLC',
          client: 'Roberto Garcia',
          folderPaths: [],
          createdAt: new Date().toISOString(),
          isSample: true,
        },
      ],
      activeMatterId: null,
    });

    render(<MatterHub matterId={SAMPLE_MATTER_ID} onBack={() => undefined} />);

    expect(screen.getByTestId('hub-panel-clientmap')).toBeInTheDocument();
    expect(screen.queryByTestId('hub-sample-glance')).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The client-detail hub is a tabbed workspace: Overview (the Client Map) ·
// Documents · Email · Activity. The old shortcut row that flipped the window to
// a GLOBAL surface is gone; the scoped per-client surfaces render in place.
// ─────────────────────────────────────────────────────────────────────────────

describe('MatterHub — sub-tab workspace', () => {
  beforeEach(() => {
    resetStore();
  });

  it('leads with the Client Map under an Overview/Documents/Email/Activity sub-tab bar', () => {
    useMatterStore.getState().createMatter({ name: 'Redesign Co', client: 'Redesign Co' });
    const matter = useMatterStore.getState().matters[0]!;
    render(<MatterHub matterId={matter.id} onBack={() => undefined} />);

    // The sub-tab bar replaces the old shortcut row.
    expect(screen.getByTestId('hub-subtab-bar')).toBeInTheDocument();
    expect(screen.getByTestId('hub-subtab-overview')).toBeInTheDocument();
    expect(screen.getByTestId('hub-subtab-documents')).toBeInTheDocument();
    expect(screen.getByTestId('hub-subtab-email')).toBeInTheDocument();
    expect(screen.getByTestId('hub-subtab-activity')).toBeInTheDocument();
    expect(screen.queryByTestId('hub-shortcut-row')).toBeNull();

    // Overview is the default and leads with the Client Map.
    expect(screen.getByTestId('hub-subtab-panel-overview')).toBeInTheDocument();
    expect(screen.getByTestId('hub-panel-clientmap')).toBeInTheDocument();
  });

  it('clicking a sub-tab renders its supplied scoped surface in place (no global navigation)', () => {
    useMatterStore.getState().createMatter({ name: 'Tabbed Co', client: 'Tabbed Co' });
    const matter = useMatterStore.getState().matters[0]!;

    // A global matter-launch must NOT fire when switching sub-tabs.
    const events: CustomEvent[] = [];
    const handler = (e: Event) => { events.push(e as CustomEvent); };
    window.addEventListener('keepance:matter-launch', handler);

    render(
      <MatterHub
        matterId={matter.id}
        onBack={() => undefined}
        renderDocuments={() => <div data-testid="stub-documents">docs</div>}
        renderEmail={() => <div data-testid="stub-email">email</div>}
        renderActivity={() => <div data-testid="stub-activity">activity</div>}
      />,
    );

    fireEvent.click(screen.getByTestId('hub-subtab-documents'));
    expect(screen.getByTestId('hub-subtab-panel-documents')).toBeInTheDocument();
    expect(screen.getByTestId('stub-documents')).toBeInTheDocument();
    expect(screen.queryByTestId('hub-panel-clientmap')).toBeNull();

    fireEvent.click(screen.getByTestId('hub-subtab-email'));
    expect(screen.getByTestId('stub-email')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('hub-subtab-activity'));
    expect(screen.getByTestId('stub-activity')).toBeInTheDocument();

    // Back to Overview shows the Client Map again.
    fireEvent.click(screen.getByTestId('hub-subtab-overview'));
    expect(screen.getByTestId('hub-panel-clientmap')).toBeInTheDocument();

    expect(events).toHaveLength(0);
    window.removeEventListener('keepance:matter-launch', handler);
  });

  it('a sub-tab with no supplied surface shows a graceful placeholder', () => {
    useMatterStore.getState().createMatter({ name: 'Bare Co', client: 'Bare Co' });
    const matter = useMatterStore.getState().matters[0]!;
    render(<MatterHub matterId={matter.id} onBack={() => undefined} />);

    fireEvent.click(screen.getByTestId('hub-subtab-documents'));
    expect(screen.getByTestId('hub-subtab-unavailable')).toBeInTheDocument();
  });
});
