/**
 * matterHub.test.tsx
 *
 * Tests for MatterHub component + the list<->hub wiring in MattersHome.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { useMatterStore, SAMPLE_MATTER_ID } from '@/platform/matter/matterStore';
import { useClientMapStore } from '@/platform/clientMap/clientMapStore';
import { emptyClientMap } from '@/platform/clientMap/types';

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

vi.mock('@/platform/rag/MemoryService', () => ({
  MemoryService: {
    retrieve: vi.fn(async () => []),
  },
}));

// ── AI Chat Store ──────────────────────────────────────────────────────────────
vi.mock('@/platform/state/aiChatStore', () => ({
  useAIChatStore: (sel: (s: { sessions: Record<string, unknown> }) => unknown) =>
    sel({ sessions: {} }),
}));

// ── Import components after mocks ──────────────────────────────────────────────
import { MattersHome } from '@/features/matters/MattersHome';
import { MatterHub } from '@/features/matters/MatterHub';
import { useCrmWriteQueueStore } from '@/platform/state/crmWriteQueueStore';

function resetStore() {
  useMatterStore.setState({ matters: [], activeMatterId: null, clientMapHubId: null, clientMapHubTab: null });
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

    // The hub's defining marker is the sub-tab bar (Client Map / Documents /
    // Email / Activity). The old in-header back chevron was removed — returning
    // to the clients list now happens via the left-nav "Client Map" item.
    expect(screen.getByTestId('hub-subtab-bar')).toBeInTheDocument();
  });

  it('hub header shows the client name', () => {
    useMatterStore.getState().createMatter({ name: 'Smith Estate', client: 'Jane Smith' });
    const matter = useMatterStore.getState().matters[0]!;

    render(<MatterHub matterId={matter.id} onBack={() => undefined} />);

    // The header title is just the client NAME (the "- Smith Estate" matter
    // suffix is dropped; the map icon + left nav carry the rest of the context).
    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading.textContent).toContain('Jane Smith');
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

  it('offers both Word and PDF exports for a ready Client Map', () => {
    useMatterStore.getState().createMatter({ name: 'Hendricks Household', client: 'Hendricks' });
    const matter = useMatterStore.getState().matters[0]!;
    const map = { ...emptyClientMap(matter.id), lastBuiltAt: '2026-07-07T00:00:00.000Z' };
    map.sections[0]!.items.push({
      id: 'i1',
      text: 'Robert and Susan are retired.',
      origin: 'ai',
      isAssumption: false,
      sources: [],
      updatedAt: '2026-07-07T00:00:00.000Z',
    });
    useClientMapStore.getState().setMap(matter.id, map);

    render(<MatterHub matterId={matter.id} onBack={() => undefined} />);

    expect(screen.getByTestId('clientmap-export-word')).toHaveTextContent('Export Word');
    expect(screen.getByTestId('clientmap-export-pdf')).toHaveTextContent('Export PDF');
  });

  it('shows honest sync copy when the Client Map is unchanged', async () => {
    useMatterStore.getState().createMatter({ name: 'Hendricks Household', client: 'Hendricks' });
    const matter = useMatterStore.getState().matters[0]!;
    const map = { ...emptyClientMap(matter.id), lastBuiltAt: '2026-07-07T00:00:00.000Z', lastSourceFingerprint: '0:::0:' };
    map.sections[0]!.items.push({
      id: 'i1',
      text: 'Robert and Susan are retired.',
      origin: 'ai',
      isAssumption: false,
      sources: [],
      updatedAt: '2026-07-07T00:00:00.000Z',
    });
    useClientMapStore.getState().setMap(matter.id, map);

    render(<MatterHub matterId={matter.id} onBack={() => undefined} />);
    fireEvent.click(screen.getByTestId('clientmap-sync-button'));

    await waitFor(() => {
      expect(screen.getByTestId('clientmap-last-updated')).toHaveTextContent('No new changes');
    });
    expect(useClientMapStore.getState().getMap(matter.id)?.lastBuiltAt).toBe('2026-07-07T00:00:00.000Z');
  });

  it('does not render the old updates-to-review tray when stored pending updates exist', () => {
    useMatterStore.getState().createMatter({ name: 'Hendricks Household', client: 'Hendricks' });
    const matter = useMatterStore.getState().matters[0]!;
    const map = { ...emptyClientMap(matter.id), lastBuiltAt: '2026-07-07T00:00:00.000Z' };
    map.sections[2]!.items.push({
      id: 'existing-money-item',
      text: 'Existing account detail',
      origin: 'ai',
      isAssumption: false,
      sources: [],
      updatedAt: '2026-07-07T00:00:00.000Z',
    });
    map.pendingUpdates = [
      {
        id: 'remove-update',
        sectionKey: 'money',
        op: 'remove',
        itemId: 'existing-money-item',
        reason: 'Would remove map content',
        createdAt: '2026-07-07T00:00:00.000Z',
      },
    ];
    useClientMapStore.getState().setMap(matter.id, map);

    render(<MatterHub matterId={matter.id} onBack={() => undefined} />);

    expect(screen.queryByTestId('clientmap-updates-marker')).toBeNull();
    expect(screen.queryByText(/updates? to review/i)).toBeNull();
    expect(screen.getByTestId('clientmap-panel')).toBeInTheDocument();
  });

  it('hub does NOT show Isolated badge when matter is not privileged', () => {
    useMatterStore.getState().createMatter({ name: 'Normal Matter', client: 'Client B' });
    const matter = useMatterStore.getState().matters[0]!;

    render(<MatterHub matterId={matter.id} onBack={() => undefined} />);

    expect(screen.queryByTestId('hub-isolated-badge')).toBeNull();
  });

  it('closing the hub returns to the matter list', () => {
    useMatterStore.getState().createMatter({ name: 'Back Test', client: 'Client' });
    const matter = useMatterStore.getState().matters[0]!;

    render(<MattersHome />);

    // Open the hub
    fireEvent.click(screen.getByTestId(`matter-row-${matter.id}`));
    expect(screen.getByTestId('hub-subtab-bar')).toBeInTheDocument();

    // The in-header back chevron is gone; closing the hub is now driven by the
    // store (what the left-nav "Client Map" item does — App.tsx onTabChange).
    act(() => {
      useMatterStore.getState().setClientMapHubId(null);
    });

    // Hub should be gone, list visible again
    expect(screen.queryByTestId('hub-subtab-bar')).not.toBeInTheDocument();
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
    window.addEventListener('lantern:matter-launch', handler);

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
    window.removeEventListener('lantern:matter-launch', handler);
  });

  it('a sub-tab with no supplied surface shows a graceful placeholder', () => {
    useMatterStore.getState().createMatter({ name: 'Bare Co', client: 'Bare Co' });
    const matter = useMatterStore.getState().matters[0]!;
    render(<MatterHub matterId={matter.id} onBack={() => undefined} />);

    fireEvent.click(screen.getByTestId('hub-subtab-documents'));
    expect(screen.getByTestId('hub-subtab-unavailable')).toBeInTheDocument();
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Client Map "Edit" — the headline WebView2 fix. Native window.prompt is dead
  // in the Tauri Windows build, so the Edit button used to do literally nothing.
  // It must now open the in-app PromptDialog (prefilled with the item's text)
  // and save via editItem on confirm.
  // ───────────────────────────────────────────────────────────────────────────

  it('Client Map "Edit" opens the in-app prompt prefilled, and saves via editItem', async () => {
    useMatterStore.getState().createMatter({ name: 'Edit Co', client: 'Edit Co' });
    const matter = useMatterStore.getState().matters[0]!;

    // Seed a Client Map whose first section has an editable, sourced fact so the
    // map renders "ready" and the SectionPanel shows the item's Edit button.
    const map = emptyClientMap(matter.id);
    map.sections[0]!.items.push({
      id: 'item-1',
      text: 'Client owns a rental property',
      origin: 'ai',
      isAssumption: false,
      sources: [{ kind: 'document', ref: '/docs/deed.pdf', snippet: 'deed' }],
      updatedAt: 't',
    });
    act(() => {
      useClientMapStore.getState().setMap(matter.id, map);
    });

    // Guard: the fix must NOT fall back to the dead native prompt.
    const nativePrompt = vi.spyOn(window, 'prompt');

    render(<MatterHub matterId={matter.id} onBack={() => undefined} />);

    // Click the item's Edit button.
    fireEvent.click(screen.getAllByTestId('clientmap-item-edit')[0]!);

    // The in-app prompt appears, prefilled with the current text.
    const input = (await screen.findByDisplayValue('Client owns a rental property')) as HTMLInputElement;
    expect(input).toBeInTheDocument();
    expect(nativePrompt).not.toHaveBeenCalled();

    // Edit and save.
    fireEvent.change(input, { target: { value: 'Client owns TWO rental properties' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    // The edit is persisted through editItem (real store update).
    await waitFor(() => {
      const updated = useClientMapStore.getState().getMap(matter.id);
      const item = updated?.sections[0]?.items.find((it) => it.id === 'item-1');
      expect(item?.text).toBe('Client owns TWO rental properties');
    });

    nativePrompt.mockRestore();
  });

  it('Client Map "Edit" cancel leaves the item unchanged', async () => {
    useMatterStore.getState().createMatter({ name: 'Cancel Co', client: 'Cancel Co' });
    const matter = useMatterStore.getState().matters[0]!;

    const map = emptyClientMap(matter.id);
    map.sections[0]!.items.push({
      id: 'item-1',
      text: 'Original fact',
      origin: 'ai',
      isAssumption: false,
      sources: [{ kind: 'document', ref: '/docs/deed.pdf', snippet: 'deed' }],
      updatedAt: 't',
    });
    act(() => {
      useClientMapStore.getState().setMap(matter.id, map);
    });

    render(<MatterHub matterId={matter.id} onBack={() => undefined} />);

    fireEvent.click(screen.getAllByTestId('clientmap-item-edit')[0]!);
    const input = await screen.findByDisplayValue('Original fact');
    fireEvent.change(input, { target: { value: 'Should be discarded' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    await waitFor(() => {
      expect(screen.queryByDisplayValue('Should be discarded')).not.toBeInTheDocument();
    });
    const after = useClientMapStore.getState().getMap(matter.id);
    expect(after?.sections[0]?.items[0]?.text).toBe('Original fact');
  });

  // Codex adversarial review catch: CrmWriteReviewCard was originally nested
  // inside the `clientMap.status === 'ready'` gate.
  // A queued Wealthbox write from the (always-available) shared notes editor
  // must stay reachable for approval/dismiss even when the Client Map itself
  // hasn't finished building yet (or errored, or is empty) — otherwise the
  // queued item becomes invisible with no way to approve or dismiss it.
  it('shows the CRM write review card even when the Client Map is not ready', async () => {
    useMatterStore.getState().createMatter({ name: 'Not Ready Co', client: 'Not Ready Co' });
    const matter = useMatterStore.getState().matters[0]!;
    useCrmWriteQueueStore.setState({ items: [] });
    useCrmWriteQueueStore.getState().enqueue({
      kind: 'note',
      matterId: matter.id,
      title: 'Note title',
      body: 'Note body',
      sourceRef: 'note:' + matter.id,
    });

    render(<MatterHub matterId={matter.id} onBack={() => undefined} />);

    // No Client Map was seeded, so status never reaches 'ready' in this test.
    expect(screen.queryByTestId('hub-clientmap-empty')).toBeNull();
    expect(useClientMapStore.getState().getMap(matter.id)).toBeUndefined();

    // The card still mounted and ran its connection check (this test's global
    // isTauri() mock returns false, so it renders the disconnected hint —
    // proof the card exists in the tree at all is what matters here).
    await waitFor(() => {
      expect(screen.getByText(/connect wealthbox to send/i)).toBeInTheDocument();
    });

    useCrmWriteQueueStore.setState({ items: [] });
  });

  // QA finding (P2): CrmWriteReviewCard only ever mounted inside the Overview
  // sub-tab — a pending Wealthbox proposal was invisible to an advisor
  // sitting on Documents/Email/Activity. A slim presence banner in the hub
  // chrome, shown on every OTHER sub-tab, with a jump back to Overview to
  // review/approve.
  it('shows a pending-review banner on non-overview sub-tabs, which jumps back to Overview on click', async () => {
    useMatterStore.getState().createMatter({ name: 'Pending Review Co', client: 'Pending Review Co' });
    const matter = useMatterStore.getState().matters[0]!;
    useCrmWriteQueueStore.setState({ items: [] });
    useCrmWriteQueueStore.getState().enqueue({
      kind: 'note',
      matterId: matter.id,
      title: 'Note title',
      body: 'Note body',
      sourceRef: 'note:' + matter.id,
    });

    render(
      <MatterHub
        matterId={matter.id}
        onBack={() => undefined}
        renderDocuments={() => <div data-testid="stub-documents">docs</div>}
      />,
    );

    // Not shown on Overview — the full card already lives there.
    expect(screen.queryByTestId('hub-crm-pending-banner')).toBeNull();

    fireEvent.click(screen.getByTestId('hub-subtab-documents'));
    expect(screen.getByTestId('hub-crm-pending-banner')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('hub-crm-pending-banner-review-now'));
    expect(screen.getByTestId('hub-subtab-panel-overview')).toBeInTheDocument();
    expect(screen.queryByTestId('hub-crm-pending-banner')).toBeNull();

    useCrmWriteQueueStore.setState({ items: [] });
  });

  it('does not show the pending-review banner once every queued item is sent', () => {
    useMatterStore.getState().createMatter({ name: 'All Sent Co', client: 'All Sent Co' });
    const matter = useMatterStore.getState().matters[0]!;
    useCrmWriteQueueStore.setState({
      items: [
        {
          id: 'x1',
          kind: 'note',
          matterId: matter.id,
          title: 'T',
          body: 'B',
          sourceRef: 'note:' + matter.id,
          status: 'sent',
          remoteId: '9',
        },
      ],
    });

    render(
      <MatterHub
        matterId={matter.id}
        onBack={() => undefined}
        renderDocuments={() => <div data-testid="stub-documents">docs</div>}
      />,
    );
    fireEvent.click(screen.getByTestId('hub-subtab-documents'));
    expect(screen.queryByTestId('hub-crm-pending-banner')).toBeNull();

    useCrmWriteQueueStore.setState({ items: [] });
  });

  it('opens directly on a requested sub-tab from the client-list quick-action signal', async () => {
    useMatterStore.getState().createMatter({ name: 'Quick Co', client: 'Quick Co' });
    const matter = useMatterStore.getState().matters[0]!;
    // The event bus set this one-shot signal when routing a row's Email action.
    useMatterStore.getState().setClientMapHubTab('email');

    render(
      <MatterHub
        matterId={matter.id}
        onBack={() => undefined}
        renderEmail={() => <div data-testid="stub-email">email</div>}
      />,
    );

    // Lands on Email (not Overview) from the initializer...
    expect(screen.getByTestId('stub-email')).toBeInTheDocument();
    expect(screen.queryByTestId('hub-panel-clientmap')).toBeNull();
    // ...and the one-shot signal is consumed (deferred via queueMicrotask).
    await waitFor(() => {
      expect(useMatterStore.getState().clientMapHubTab).toBeNull();
    });
  });
});
