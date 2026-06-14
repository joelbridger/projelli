/**
 * matterHub.test.tsx
 *
 * Tests for MatterHub component + the list<->hub wiring in ReimaginedMattersHome.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useMatterStore, SAMPLE_MATTER_ID } from '@/stores/matterStore';

// ── Mail commands (async probes used by GetStartedCard) ───────────────────────
vi.mock('@/utils/mail-commands', () => ({
  mailIsConnected: async () => false,
  gmailIsConnected: async () => false,
  mailImapIsConnected: async () => false,
  mailConnectedAccounts: async () => [],
}));

// ── useApiKeys ─────────────────────────────────────────────────────────────────
vi.mock('@/hooks/useApiKeys', () => ({
  useApiKeys: () => ({ apiKeys: [] }),
}));

// ── useFirm (no firm session in these tests) ──────────────────────────────────
vi.mock('@/hooks/useFirm', () => ({
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
vi.mock('@/stores/workspaceStore', () => ({
  useWorkspaceStore: (sel: (s: { rootPath: string | null; fileTree: unknown[] }) => unknown) =>
    sel({ rootPath: null, fileTree: [] }),
}));

// ── Tauri keychain (firm module deps) ─────────────────────────────────────────
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(async () => { throw new Error('not in test'); }),
  isTauri: () => false,
}));

// ── AuditService ───────────────────────────────────────────────────────────────
vi.mock('@/modules/audit/AuditService', () => ({
  AuditService: class { append() {} },
  isAuditEncrypted: () => false,
}));

// ── firm key service ───────────────────────────────────────────────────────────
vi.mock('@/modules/firm/matterKeyService', () => ({
  getOrCreateMatterKey: async () => 'key',
  publishMatterKeyToMembers: async () => ({ published: 0, skippedWalled: 0 }),
  obtainMatterKey: async () => null,
}));

vi.mock('@/modules/firm/deviceKeys', () => ({
  registerDevice: async () => undefined,
  _resetDeviceCache: () => undefined,
  getOrCreateDeviceKeypair: async () => ({ deviceId: 'test', publicJwk: {} }),
}));

vi.mock('@/modules/models/fetchUtils', () => ({
  getCorsSafeFetch: async () => vi.fn(),
}));

// ── AI Chat Store ──────────────────────────────────────────────────────────────
vi.mock('@/stores/aiChatStore', () => ({
  useAIChatStore: (sel: (s: { sessions: Record<string, unknown> }) => unknown) =>
    sel({ sessions: {} }),
}));

// ── Import components after mocks ──────────────────────────────────────────────
import { ReimaginedMattersHome } from '@/components/matter/ReimaginedMattersHome';
import { MatterHub } from '@/components/matter/MatterHub';

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

    render(<ReimaginedMattersHome />);

    fireEvent.click(screen.getByTestId(`reimagined-matter-row-${matter.id}`));

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

  it('Documents panel > dispatches keepance:matter-launch with surface files', () => {
    useMatterStore.getState().createMatter({ name: 'Doc Panel Test', client: 'Client' });
    const matter = useMatterStore.getState().matters[0]!;

    const events: CustomEvent[] = [];
    const handler = (e: Event) => { events.push(e as CustomEvent); };
    window.addEventListener('keepance:matter-launch', handler);

    render(<MatterHub matterId={matter.id} onBack={() => undefined} />);

    fireEvent.click(screen.getByTestId('hub-panel-documents-open'));

    expect(events).toHaveLength(1);
    expect(events[0]!.detail.surface).toBe('files');
    expect(events[0]!.detail.matterId).toBe(matter.id);

    window.removeEventListener('keepance:matter-launch', handler);
  });

  it('Email panel > dispatches keepance:matter-launch with surface email', () => {
    useMatterStore.getState().createMatter({ name: 'Email Panel Test', client: 'Client' });
    const matter = useMatterStore.getState().matters[0]!;

    const events: CustomEvent[] = [];
    const handler = (e: Event) => { events.push(e as CustomEvent); };
    window.addEventListener('keepance:matter-launch', handler);

    render(<MatterHub matterId={matter.id} onBack={() => undefined} />);

    fireEvent.click(screen.getByTestId('hub-panel-email-open'));

    expect(events).toHaveLength(1);
    expect(events[0]!.detail.surface).toBe('email');
    expect(events[0]!.detail.matterId).toBe(matter.id);

    window.removeEventListener('keepance:matter-launch', handler);
  });

  it('Workflows panel > dispatches keepance:matter-launch with surface workflows', () => {
    useMatterStore.getState().createMatter({ name: 'Workflow Panel Test', client: 'Client' });
    const matter = useMatterStore.getState().matters[0]!;

    const events: CustomEvent[] = [];
    const handler = (e: Event) => { events.push(e as CustomEvent); };
    window.addEventListener('keepance:matter-launch', handler);

    render(<MatterHub matterId={matter.id} onBack={() => undefined} />);

    fireEvent.click(screen.getByTestId('hub-panel-workflows-open'));

    expect(events).toHaveLength(1);
    expect(events[0]!.detail.surface).toBe('workflows');
    expect(events[0]!.detail.matterId).toBe(matter.id);

    window.removeEventListener('keepance:matter-launch', handler);
  });

  it('Activity panel > dispatches keepance:matter-launch with surface audit', () => {
    useMatterStore.getState().createMatter({ name: 'Activity Panel Test', client: 'Client' });
    const matter = useMatterStore.getState().matters[0]!;

    const events: CustomEvent[] = [];
    const handler = (e: Event) => { events.push(e as CustomEvent); };
    window.addEventListener('keepance:matter-launch', handler);

    render(<MatterHub matterId={matter.id} onBack={() => undefined} />);

    fireEvent.click(screen.getByTestId('hub-panel-activity-open'));

    expect(events).toHaveLength(1);
    expect(events[0]!.detail.surface).toBe('audit');
    expect(events[0]!.detail.matterId).toBe(matter.id);

    window.removeEventListener('keepance:matter-launch', handler);
  });

  it('back button returns to matter list', () => {
    useMatterStore.getState().createMatter({ name: 'Back Test', client: 'Client' });
    const matter = useMatterStore.getState().matters[0]!;

    render(<ReimaginedMattersHome />);

    // Open the hub
    fireEvent.click(screen.getByTestId(`reimagined-matter-row-${matter.id}`));
    expect(screen.getByTestId('hub-back-btn')).toBeInTheDocument();

    // Click back
    fireEvent.click(screen.getByTestId('hub-back-btn'));

    // Hub should be gone, list visible again
    expect(screen.queryByTestId('hub-back-btn')).not.toBeInTheDocument();
    expect(screen.getByTestId(`reimagined-matter-row-${matter.id}`)).toBeInTheDocument();
  });

  it('sample matter shows curated at-a-glance', () => {
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

    expect(screen.getByTestId('hub-sample-glance')).toBeInTheDocument();
  });
});
