/**
 * matterHub.test.tsx
 *
 * Tests for MatterHub component + the list<->hub wiring in MattersHome.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act, within } from '@testing-library/react';
import { useMatterStore, SAMPLE_MATTER_ID } from '@/platform/matter/matterStore';
import { useClientMapStore } from '@/platform/clientMap/clientMapStore';
import { emptyClientMap } from '@/platform/clientMap/types';
import type { AuditEntry } from '@/platform/types/audit';
import { useFirmStore } from '@/platform/firm/firmStore';
import { type IntakeRecord, useIntakeStore } from '@/platform/intake/intakeStore';
import {
  issueSharedClientSelection,
  readAuthoritativeMatterScope,
  replaceCanonicalHouseholdDirectory,
  requestClearClientSelection,
  requestSharedClientSelection,
} from '@/platform/client-context';
import { setDevFlagOverride } from '@/platform/flags/router';

const intakeLinkActionSpies = vi.hoisted(() => ({
  loadIntakeLinkSecret: vi.fn(),
  updateIntakeLinkSecret: vi.fn(),
  regenerateIntakeLink: vi.fn(),
  relayExtendIntake: vi.fn(),
  relayRevokeIntake: vi.fn(),
  relayRegenerateIntake: vi.fn(),
}));

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
vi.mock('@/platform/fs/workspaceStore', () => {
  const workspaceState = { rootPath: null as string | null, fileTree: [] as unknown[] };
  const useWorkspaceStore = Object.assign(
    (sel: (s: typeof workspaceState) => unknown) => sel(workspaceState),
    { getState: () => workspaceState },
  );
  return {
    useWorkspaceStore,
    normalizeRecentWorkspacePath: (path: string) => path.replace(/\\/g, '/'),
  };
});

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
  isMemoryEnabled: () => false,
  MemoryService: {
    retrieve: vi.fn(async () => []),
  },
}));

vi.mock('@/platform/intake/intakeKeychain', () => ({
  loadIntakeLinkSecret: intakeLinkActionSpies.loadIntakeLinkSecret,
  updateIntakeLinkSecret: intakeLinkActionSpies.updateIntakeLinkSecret,
}));

vi.mock('@/platform/intake/intakeLifecycle', () => ({
  regenerateIntakeLink: intakeLinkActionSpies.regenerateIntakeLink,
}));

vi.mock('@/platform/intake/IntakeRelayClient', () => ({
  IntakeRelayClient: vi.fn(function IntakeRelayClientMock() {
    return {
      extendIntake: intakeLinkActionSpies.relayExtendIntake,
      revokeIntake: intakeLinkActionSpies.relayRevokeIntake,
      regenerateIntake: intakeLinkActionSpies.relayRegenerateIntake,
    };
  }),
}));

// ── AI Chat Store ──────────────────────────────────────────────────────────────
vi.mock('@/platform/state/aiChatStore', () => ({
  useAIChatStore: (sel: (s: { sessions: Record<string, unknown> }) => unknown) =>
    sel({ sessions: {} }),
}));

// ── Import components after mocks ──────────────────────────────────────────────
import { MattersHome } from '@/features/matters/MattersHome';
import { MatterHub } from '@/features/matters/MatterHub';
import { AuditHome } from '@/features/audit/AuditHome';
import { useCrmWriteQueueStore } from '@/platform/state/crmWriteQueueStore';
import { deriveAuthToken } from '@/platform/intake/intakeCrypto';
import { b64ToBytes } from '@/platform/intake/pageSeal';

function resetStore() {
  useMatterStore.setState({ matters: [], activeMatterId: null, clientMapHubId: null, clientMapHubTab: null, pendingMeetingOpen: null });
  requestClearClientSelection();
  replaceCanonicalHouseholdDirectory('wealthbox', null);
  useIntakeStore.getState().resetForTests();
  useFirmStore.setState({ seatToken: null, accessToken: null, session: null });
  intakeLinkActionSpies.loadIntakeLinkSecret.mockReset();
  intakeLinkActionSpies.updateIntakeLinkSecret.mockReset();
  intakeLinkActionSpies.regenerateIntakeLink.mockReset();
  intakeLinkActionSpies.relayExtendIntake.mockReset();
  intakeLinkActionSpies.relayRevokeIntake.mockReset();
  intakeLinkActionSpies.relayRegenerateIntake.mockReset();
}

afterEach(() => {
  setDevFlagOverride('selection-authority-boot-gate', undefined);
});

function makeIntakeForMatter(matterId: string): IntakeRecord {
  return {
    intakeId: 'intake-regenerate',
    matterId,
    clientFirstName: 'Sarah',
    clientEmail: 'sarah@example.test',
    firmName: 'North Star Planning',
    status: 'revoked',
    link: 'https://forms.example.test/i/intake-regenerate#old-secret',
    expiresAt: '2026-07-01T00:00:00.000Z',
    checklistVersion: 1,
    items: [
      { itemId: 'tax-return', label: 'Tax return', state: 'received' },
      { itemId: 'income-docs', label: 'Income documents', state: 'not_started' },
    ],
    receivedItems: [],
    flags: [],
    knownSessionIds: [],
    knownSubmissionIds: [],
    nudges: [],
    publicKeyRawB64: 'AQIDBA==',
    checklistCiphertextB64: 'old-checklist',
    stateCiphertextB64: 'old-state',
  };
}

async function openFirstClientMapItemEdit() {
  fireEvent.pointerDown(screen.getAllByTestId('clientmap-item-menu')[0]!, { button: 0, ctrlKey: false });
  return screen.findByTestId('clientmap-item-edit');
}

function makeMeetingsWorkspace() {
  const meetingDir = 'C:/WS/Clients/Acme/Meetings/direct';
  return {
    exists: vi.fn(async (path: string) => path === 'C:/WS/Clients/Acme/Meetings'),
    list: vi.fn(async (path: string) => {
      if (path === 'C:/WS/Clients/Acme/Meetings') {
        return [{ name: 'direct', path: meetingDir, type: 'folder' as const }];
      }
      if (path === meetingDir) {
        return [
          { name: 'meeting.json', path: `${meetingDir}/meeting.json`, type: 'file' as const },
          { name: 'transcript.json', path: `${meetingDir}/transcript.json`, type: 'file' as const },
        ];
      }
      return [];
    }),
    readFile: vi.fn(async (path: string) => {
      if (path.endsWith('.consent-ledger.json')) return JSON.stringify({ entries: [], notices: [] });
      if (path.endsWith('meeting.json')) {
        return JSON.stringify({
          matterId: 'm1',
          startedAt: '2026-07-04T10:00:00Z',
          customTitle: 'Direct review',
          consent: { mode: 'one-party', confirmedBy: 'user', confirmedAt: '2026-07-04T10:00:00Z' },
          meetingFileVisibility: {
            version: 1,
            meetingSubject: {
              id: 'meeting-file:sample-direct-review',
              kind: 'meeting-note',
              lineage: 'accountless-unrestricted',
            },
            files: {
              'meeting.json': {
                id: 'meeting-file:sample-direct-review:file:meeting.json',
                kind: 'file-reference',
                lineage: 'accountless-unrestricted',
              },
              'transcript.json': {
                id: 'meeting-file:sample-direct-review:file:transcript.json',
                kind: 'file-reference',
                lineage: 'accountless-unrestricted',
              },
            },
          },
        });
      }
      if (path.endsWith('transcript.json')) return JSON.stringify({ segments: [] });
      throw new Error('not present');
    }),
    writeFile: vi.fn(async () => {}),
    readFileBinary: vi.fn(async () => { throw new Error('not present'); }),
    writeFileBinary: vi.fn(async () => {}),
    delete: vi.fn(async () => {}),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Hub wiring — list<->hub navigation
// ─────────────────────────────────────────────────────────────────────────────

describe('MatterHub — list to hub navigation', () => {
  beforeEach(resetStore);

  it('clicking a matter row opens the hub', async () => {
    useMatterStore.getState().createMatter({ name: 'Acme v. Beta', client: 'Acme' });
    const matter = useMatterStore.getState().matters[0]!;

    render(<MattersHome />);

    fireEvent.click(screen.getByTestId(`matter-row-${matter.id}`));

    // The hub's defining marker is the sub-tab bar (Client Map / Documents /
    // Email / Activity). The old in-header back chevron was removed — returning
    // to the clients list now happens via the left-nav "Client Map" item.
    expect(await screen.findByTestId('hub-subtab-bar')).toBeInTheDocument();
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

  it('opens all Client Map actions from one three-dot menu', async () => {
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

    expect(screen.queryByTestId('clientmap-export-word')).toBeNull();
    expect(screen.queryByTestId('clientmap-export-pdf')).toBeNull();
    expect(screen.queryByTestId('clientmap-sync-button')).toBeNull();
    expect(screen.queryByTestId('clientmap-history-button')).toBeNull();

    const menuButton = screen.getByTestId('clientmap-actions-menu-button');
    expect(menuButton).toHaveAccessibleName('Actions');
    fireEvent.pointerDown(menuButton);

    expect(await screen.findByTestId('clientmap-export-word')).toHaveTextContent('Export client map (DOCX)');
    expect(screen.getByTestId('clientmap-export-pdf')).toHaveTextContent('Export client map (PDF)');
    expect(screen.getByTestId('clientmap-sync-button')).toHaveTextContent('Update map');
    expect(screen.getByTestId('clientmap-history-button')).toHaveTextContent('History');
  });

  it('renders the Client Map header as menu plus updated text', () => {
    useMatterStore.getState().createMatter({ name: 'Hendricks Household', client: 'Hendricks' });
    const matter = useMatterStore.getState().matters[0]!;
    const map = { ...emptyClientMap(matter.id), lastBuiltAt: '2026-07-07T00:00:00.000Z' };
    useClientMapStore.getState().setMap(matter.id, map);

    render(<MatterHub matterId={matter.id} onBack={() => undefined} />);

    const group = screen.getByTestId('clientmap-header-icon-group');
    const menuButton = screen.getByTestId('clientmap-actions-menu-button');
    const lastUpdated = screen.getByTestId('clientmap-last-updated');

    expect(group).toContainElement(menuButton);
    expect(screen.queryByTestId('clientmap-download-button')).toBeNull();
    expect(screen.queryByTestId('clientmap-sync-group')).toBeNull();
    expect(screen.queryByTestId('clientmap-sync-button')).toBeNull();
    expect(screen.queryByTestId('clientmap-history-button')).toBeNull();
    expect(menuButton).toHaveClass('kp-icon-btn--ghost');
    expect(menuButton.compareDocumentPosition(lastUpdated) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
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
    fireEvent.pointerDown(screen.getByTestId('clientmap-actions-menu-button'));
    const syncButton = await screen.findByTestId('clientmap-sync-button');
    expect(syncButton).toHaveTextContent('Update map');

    fireEvent.click(syncButton);

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

  it('does not show the old local-only note above a ready Client Map', () => {
    useMatterStore.getState().createMatter({ name: 'Local Co', client: 'Local Co' });
    const matter = useMatterStore.getState().matters[0]!;
    const map = { ...emptyClientMap(matter.id), lastBuiltAt: '2026-07-07T00:00:00.000Z' };
    map.sections[0]!.items.push({
      id: 'local-ready-item',
      text: 'Ready map fact',
      origin: 'ai',
      isAssumption: false,
      sources: [],
      updatedAt: '2026-07-07T00:00:00.000Z',
    });
    useClientMapStore.getState().setMap(matter.id, map);

    render(<MatterHub matterId={matter.id} onBack={() => undefined} />);

    expect(screen.queryByTestId('hub-clientmap-local-notice')).toBeNull();
    expect(screen.getByTestId('clientmap-panel')).toBeInTheDocument();
  });

  it('hub does NOT show Isolated badge when matter is not privileged', () => {
    useMatterStore.getState().createMatter({ name: 'Normal Matter', client: 'Client B' });
    const matter = useMatterStore.getState().matters[0]!;

    render(<MatterHub matterId={matter.id} onBack={() => undefined} />);

    expect(screen.queryByTestId('hub-isolated-badge')).toBeNull();
  });

  it('closing the hub returns to the matter list', async () => {
    useMatterStore.getState().createMatter({ name: 'Back Test', client: 'Client' });
    const matter = useMatterStore.getState().matters[0]!;

    render(<MattersHome />);

    // Open the hub
    fireEvent.click(screen.getByTestId(`matter-row-${matter.id}`));
    expect(await screen.findByTestId('hub-subtab-bar')).toBeInTheDocument();

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

  it('leads with the Client Map under an Overview/Documents/Email/Meetings sub-tab bar', () => {
    useMatterStore.getState().createMatter({ name: 'Redesign Co', client: 'Redesign Co' });
    const matter = useMatterStore.getState().matters[0]!;
    render(<MatterHub matterId={matter.id} onBack={() => undefined} />);

    // The sub-tab bar replaces the old shortcut row.
    expect(screen.getByTestId('hub-subtab-bar')).toBeInTheDocument();
    expect(screen.getByTestId('hub-subtab-overview')).toBeInTheDocument();
    expect(screen.getByTestId('hub-subtab-documents')).toBeInTheDocument();
    expect(screen.getByTestId('hub-subtab-email')).toBeInTheDocument();
    expect(screen.getByTestId('hub-subtab-meetings')).toBeInTheDocument();
    expect(screen.queryByTestId('hub-subtab-activity')).toBeNull();
    expect(screen.queryByTestId('hub-shortcut-row')).toBeNull();

    // Overview is the default and leads with the Client Map.
    expect(screen.getByTestId('hub-subtab-panel-overview')).toBeInTheDocument();
    expect(screen.getByTestId('hub-panel-clientmap')).toBeInTheDocument();
  });

  it('shows the manifest-authorized meeting in the real Meetings rail', async () => {
    const matter = useMatterStore.getState().createMatter({
      name: 'Acme Plan',
      client: 'Acme',
      folderPaths: ['C:/WS/Clients/Acme'],
      crmHouseholdKeys: ['household-acme'],
    });
    const client = {
      provider: 'wealthbox' as const,
      householdId: 'household-acme',
      displayName: 'Acme',
    };
    setDevFlagOverride('selection-authority-boot-gate', false);
    readAuthoritativeMatterScope();
    requestClearClientSelection();
    replaceCanonicalHouseholdDirectory('wealthbox', [client]);
    setDevFlagOverride('selection-authority-boot-gate', true);
    readAuthoritativeMatterScope();
    await act(async () => {
      await requestSharedClientSelection(issueSharedClientSelection(client));
    });
    await waitFor(() => {
      expect(useMatterStore.getState().activeMatterId).toBe(matter.id);
    });
    render(
      <MatterHub
        matterId={matter.id}
        onBack={() => undefined}
        workspaceService={makeMeetingsWorkspace() as never}
      />,
    );

    fireEvent.click(screen.getByTestId('hub-subtab-meetings'));
    await waitFor(() => expect(screen.getByTestId('client-meetings-tab')).toBeInTheDocument());
    expect(screen.getByRole('listbox', { name: 'Meetings' })).toBeVisible();
    expect(screen.getByTestId('client-meetings-rail-header')).toContainElement(screen.getByTestId('record-meeting-button'));
    await waitFor(() => {
      expect(screen.getAllByTestId('meeting-row')).toHaveLength(1);
      expect(screen.getByText('Direct review')).toBeVisible();
    });
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

    expect(within(screen.getByTestId('clientmap-header-icon-group')).getByTestId('hub-subtab-bar')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('hub-subtab-documents'));
    expect(screen.getByTestId('hub-subtab-panel-documents')).toBeInTheDocument();
    expect(screen.getByTestId('stub-documents')).toBeInTheDocument();
    expect(screen.queryByTestId('hub-panel-clientmap')).toBeNull();

    fireEvent.click(screen.getByTestId('hub-subtab-email'));
    expect(screen.getByTestId('stub-email')).toBeInTheDocument();

    // Back to Overview shows the Client Map again.
    fireEvent.click(screen.getByTestId('hub-subtab-overview'));
    expect(screen.getByTestId('hub-panel-clientmap')).toBeInTheDocument();

    expect(events).toHaveLength(0);
    window.removeEventListener('lantern:matter-launch', handler);
  });

  it('opens the per-client activity feed from the History menu item', async () => {
    useMatterStore.getState().createMatter({ name: 'History Co', client: 'History Co' });
    const matter = useMatterStore.getState().matters[0]!;
    const drawerEntry: AuditEntry = {
      id: 'drawer-fit-entry',
      timestamp: '2026-07-08T14:22:00.000Z',
      action: 'egress',
      description: 'Reviewed a very long client activity item that needs to wrap instead of disappearing beyond the right edge of the drawer.',
      model: 'claude-sonnet-4-with-a-long-provider-label',
      inputs: {},
      outputs: {},
      userDecision: 'approved',
      metadata: { mode: 'direct' },
    };

    render(
      <MatterHub
        matterId={matter.id}
        onBack={() => undefined}
        renderActivity={() => <AuditHome entries={[drawerEntry]} />}
      />,
    );

    expect(screen.queryByTestId('hub-subtab-activity')).toBeNull();

    fireEvent.pointerDown(screen.getByTestId('clientmap-actions-menu-button'));
    const historyButton = await screen.findByTestId('clientmap-history-button');
    expect(historyButton).toHaveTextContent('History');
    fireEvent.click(historyButton);

    const panel = screen.getByTestId('clientmap-history-panel');
    expect(panel).toBeInTheDocument();
    expect(panel).toHaveStyle({ width: '720px' });

    const row = await within(panel).findByTestId('audit-table-row');
    const actionLine = within(row).getByTestId('audit-row-action-line');
    const description = within(row).getByTestId('audit-row-description');
    const meta = within(row).getByTestId('audit-row-meta');
    const modelBadge = within(row).getByText('claude-sonnet-4-with-a-long-provider-label');

    expect(row.style.gridTemplateColumns).not.toBe('160px 1fr 120px 100px');
    expect(row.style.gridTemplateColumns).toMatch(/minmax\(0(px)?, 1fr\)/);
    expect(actionLine.style.flexWrap).toBe('wrap');
    expect(description.style.whiteSpace).toBe('normal');
    expect(description.style.overflowWrap).toBe('anywhere');
    expect(modelBadge).toHaveStyle({ whiteSpace: 'normal', overflowWrap: 'anywhere' });
    expect(meta.style.flexWrap).toBe('wrap');
    expect(meta).toHaveTextContent('Approved');
    expect(meta).toHaveTextContent('Direct');
  });

  it('a sub-tab with no supplied surface shows a graceful placeholder', () => {
    useMatterStore.getState().createMatter({ name: 'Bare Co', client: 'Bare Co' });
    const matter = useMatterStore.getState().matters[0]!;
    render(<MatterHub matterId={matter.id} onBack={() => undefined} />);

    fireEvent.click(screen.getByTestId('hub-subtab-documents'));
    expect(screen.getByTestId('hub-subtab-unavailable')).toBeInTheDocument();
  });

  it('regenerates the relay bundle before saving the new local link secret', async () => {
    const matter = useMatterStore.getState().createMatter({
      name: 'Regenerate Co',
      client: 'Regenerate Co',
    });
    const record = makeIntakeForMatter(matter.id);
    useIntakeStore.getState().upsertIntake(record);
    useFirmStore.setState({ seatToken: 'seat-token', accessToken: 'access-token' });
    intakeLinkActionSpies.loadIntakeLinkSecret.mockResolvedValue('AQIDBA==');
    intakeLinkActionSpies.regenerateIntakeLink.mockResolvedValue({
      link: 'https://forms.example.test/i/intake-regenerate#new-secret',
      tokenB64: 'new-token',
      linkSecretB64: 'new-secret-b64',
      checklistCiphertextB64: 'new-checklist',
      stateCiphertextB64: 'new-state',
    });
    intakeLinkActionSpies.relayRegenerateIntake.mockResolvedValue({ ok: true });

    render(<MatterHub matterId={matter.id} onBack={() => undefined} />);
    fireEvent.click(screen.getByTestId('hub-subtab-onboarding'));
    fireEvent.click(await screen.findByTestId('link-action-regenerate'));

    await waitFor(() => {
      expect(intakeLinkActionSpies.updateIntakeLinkSecret).toHaveBeenCalledWith(
        'intake-regenerate',
        'new-secret-b64',
      );
    });
    expect(intakeLinkActionSpies.relayRegenerateIntake).toHaveBeenCalledWith(
      'intake-regenerate',
      {
        token_b64: 'new-token',
        checklist_ciphertext_b64: 'new-checklist',
        state_ciphertext_b64: 'new-state',
      },
    );
    expect(intakeLinkActionSpies.relayRegenerateIntake.mock.invocationCallOrder[0]).toBeLessThan(
      intakeLinkActionSpies.updateIntakeLinkSecret.mock.invocationCallOrder[0]!,
    );
    expect(useIntakeStore.getState().intakesById['intake-regenerate']?.link).toBe(
      'https://forms.example.test/i/intake-regenerate#new-secret',
    );
  });

  it('keeps the old local link secret and link when relay regeneration fails', async () => {
    const matter = useMatterStore.getState().createMatter({
      name: 'Rejected Regenerate Co',
      client: 'Rejected Regenerate Co',
    });
    const record = makeIntakeForMatter(matter.id);
    useIntakeStore.getState().upsertIntake(record);
    useFirmStore.setState({ seatToken: 'seat-token', accessToken: 'access-token' });
    intakeLinkActionSpies.loadIntakeLinkSecret.mockResolvedValue('AQIDBA==');
    intakeLinkActionSpies.regenerateIntakeLink.mockResolvedValue({
      link: 'https://forms.example.test/i/intake-regenerate#new-secret',
      tokenB64: 'new-token',
      linkSecretB64: 'new-secret-b64',
      checklistCiphertextB64: 'new-checklist',
      stateCiphertextB64: 'new-state',
    });
    intakeLinkActionSpies.relayRegenerateIntake.mockRejectedValue(new Error('relay refused bundle'));

    render(<MatterHub matterId={matter.id} onBack={() => undefined} />);
    fireEvent.click(screen.getByTestId('hub-subtab-onboarding'));
    fireEvent.click(await screen.findByTestId('link-action-regenerate'));

    await waitFor(() => {
      expect(intakeLinkActionSpies.relayRegenerateIntake).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(screen.getByText('relay refused bundle')).toBeInTheDocument();
    });
    expect(intakeLinkActionSpies.updateIntakeLinkSecret).not.toHaveBeenCalled();
    const stored = useIntakeStore.getState().intakesById['intake-regenerate'];
    expect(stored?.link).toBe('https://forms.example.test/i/intake-regenerate#old-secret');
    expect(stored?.checklistCiphertextB64).toBe('old-checklist');
    expect(stored?.stateCiphertextB64).toBe('old-state');
  });

  it('restores the old relay bundle when saving the new local link secret keeps failing', async () => {
    const matter = useMatterStore.getState().createMatter({
      name: 'Rollback Regenerate Co',
      client: 'Rollback Regenerate Co',
    });
    const record = makeIntakeForMatter(matter.id);
    useIntakeStore.getState().upsertIntake(record);
    useFirmStore.setState({ seatToken: 'seat-token', accessToken: 'access-token' });
    intakeLinkActionSpies.loadIntakeLinkSecret.mockResolvedValue('AQIDBA==');
    intakeLinkActionSpies.regenerateIntakeLink.mockResolvedValue({
      link: 'https://forms.example.test/i/intake-regenerate#new-secret',
      tokenB64: 'new-token',
      linkSecretB64: 'new-secret-b64',
      checklistCiphertextB64: 'new-checklist',
      stateCiphertextB64: 'new-state',
    });
    intakeLinkActionSpies.relayRegenerateIntake.mockResolvedValue({ ok: true });
    intakeLinkActionSpies.updateIntakeLinkSecret.mockRejectedValue(new Error('secure storage unavailable'));
    const oldToken = (await deriveAuthToken(b64ToBytes('AQIDBA=='))).tokenB64;

    render(<MatterHub matterId={matter.id} onBack={() => undefined} />);
    fireEvent.click(screen.getByTestId('hub-subtab-onboarding'));
    fireEvent.click(await screen.findByTestId('link-action-regenerate'));

    await waitFor(() => {
      expect(intakeLinkActionSpies.relayRegenerateIntake).toHaveBeenCalledTimes(2);
    });
    expect(intakeLinkActionSpies.updateIntakeLinkSecret).toHaveBeenCalledTimes(3);
    expect(intakeLinkActionSpies.relayRegenerateIntake).toHaveBeenNthCalledWith(
      1,
      'intake-regenerate',
      {
        token_b64: 'new-token',
        checklist_ciphertext_b64: 'new-checklist',
        state_ciphertext_b64: 'new-state',
      },
    );
    expect(intakeLinkActionSpies.relayRegenerateIntake).toHaveBeenNthCalledWith(
      2,
      'intake-regenerate',
      {
        token_b64: oldToken,
        checklist_ciphertext_b64: 'old-checklist',
        state_ciphertext_b64: 'old-state',
      },
    );
    await waitFor(() => {
      expect(screen.getByText(/The previous link was restored and still works/u)).toBeInTheDocument();
    });
    const stored = useIntakeStore.getState().intakesById['intake-regenerate'];
    expect(stored?.link).toBe('https://forms.example.test/i/intake-regenerate#old-secret');
    expect(stored?.checklistCiphertextB64).toBe('old-checklist');
    expect(stored?.stateCiphertextB64).toBe('old-state');
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

    // Open the row menu and click the item's Edit command.
    fireEvent.click(await openFirstClientMapItemEdit());

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

    fireEvent.click(await openFirstClientMapItemEdit());
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
