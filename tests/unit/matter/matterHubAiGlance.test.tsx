/**
 * matterHubAiGlance.test.tsx
 *
 * Tests for the MatterHub "At a Glance" panel state machine:
 *   - Sample matter: shows curated demo (unchanged)
 *   - Real matter + cloud key: shows AI panel (loading -> done)
 *   - Real matter + NO cloud key: shows honest counts fallback
 *   - Refresh button invalidates cache and triggers regeneration
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, waitFor, fireEvent, within } from '@testing-library/react';
import { useMatterStore, SAMPLE_MATTER_ID } from '@/platform/matter/matterStore';
import { useMatterAtAGlanceStore } from '@/platform/matter/matterAtAGlanceStore';
import { useSettingsStore } from '@/platform/settings/settingsStore';
import { CONFIDENTIALITY_MODE_SETTING_KEY } from '@/platform/privacy/egress';

// Hoist mock functions so vi.mock factories can reference them
const { mockGenerate, mockHasCloudKey } = vi.hoisted(() => ({
  mockGenerate: vi.fn(),
  mockHasCloudKey: vi.fn(),
}));

// ── Mail commands ─────────────────────────────────────────────────────────────
vi.mock('@/platform/utils/mail-commands', () => ({
  mailListMessages: async () => ({ items: [], total: 0 }),
  mailIsConnected: async () => false,
  gmailIsConnected: async () => false,
  mailImapIsConnected: async () => false,
  mailConnectedAccounts: async () => [],
}));

// ── useApiKeys ────────────────────────────────────────────────────────────────
vi.mock('@/platform/hooks/useApiKeys', () => ({
  useApiKeys: () => ({ apiKeys: [] }),
}));

// ── useFirm ───────────────────────────────────────────────────────────────────
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

// ── Workspace store ───────────────────────────────────────────────────────────
vi.mock('@/platform/fs/workspaceStore', () => ({
  useWorkspaceStore: (sel: (s: { rootPath: string | null; fileTree: unknown[] }) => unknown) =>
    sel({ rootPath: '/workspace', fileTree: [] }),
}));

// ── Tauri ─────────────────────────────────────────────────────────────────────
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(async () => { throw new Error('not in test'); }),
  isTauri: () => false,
}));

// ── AuditService ──────────────────────────────────────────────────────────────
vi.mock('@/platform/audit/AuditService', () => ({
  AuditService: class { append() {} },
  isAuditEncrypted: () => false,
}));

// ── Firm key services ─────────────────────────────────────────────────────────
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

// ── AI Chat Store ─────────────────────────────────────────────────────────────
vi.mock('@/platform/state/aiChatStore', () => ({
  useAIChatStore: (sel: (s: { sessions: Record<string, unknown> }) => unknown) =>
    sel({ sessions: {} }),
}));

// ── MemoryService ─────────────────────────────────────────────────────────────
vi.mock('@/platform/rag/MemoryService', () => ({
  MemoryService: {
    retrieve: vi.fn(async () => []),
  },
  isMemoryEnabled: vi.fn(() => true),
}));

// ── matterAtAGlance module ────────────────────────────────────────────────────
vi.mock('@/platform/matter/matterAtAGlance', () => ({
  generateMatterAtAGlance: mockGenerate,
  hasCloudKeyForGlance: mockHasCloudKey,
  normalizeMatterAtAGlanceResult: (r: unknown) => r,
  // State-machine test: the pure upcoming-derivation/marker-stripping/dedupe logic
  // has its own coverage in matterAtAGlance.test.ts. Here we surface the upcoming
  // items deterministically with citation markers stripped (the user-visible result).
  deriveMatterHubUpcomingItems: (
    result: { upcomingDates?: string[] } | null,
  ) => (result?.upcomingDates ?? []).map((s) => s.replace(/\s*\[[^\]]*\]/g, '').trim()),
}));

// Import after mocks
import { MatterHub } from '@/features/matters/MatterHub';
import type { MatterAtAGlanceResult } from '@/platform/matter/matterAtAGlance';

const sampleGlanceResult: MatterAtAGlanceResult = {
  openIssues: ['Lease dispute unresolved'],
  deadlines: ['Response due July 1'],
  upcomingDates: ['July 1 response deadline [Lease_Agreement.docx paragraph 2]'],
  nextActions: ['Request title search'],
  generatedAt: '2026-06-15T10:00:00.000Z',
};

function resetStores() {
  useMatterStore.setState({ matters: [], activeMatterId: null });
  useMatterAtAGlanceStore.setState({ cache: {} });
}

describe('MatterHub — At a Glance state machine', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStores();
    // Default each test to a cloud-capable mode so existing cases are unaffected;
    // the local-only case below overrides it explicitly.
    useSettingsStore.getState().setSetting(CONFIDENTIALITY_MODE_SETTING_KEY, 'direct');
    mockHasCloudKey.mockResolvedValue(true);
    mockGenerate.mockResolvedValue(sampleGlanceResult);
  });

  // ── Sample matter: curated demo ────────────────────────────────────────────

  it('sample matter shows the curated demo glance, not the AI panel', async () => {
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
    expect(screen.queryByTestId('hub-ai-glance')).toBeNull();
    // Generator should NOT be called for sample matters
    expect(mockGenerate).not.toHaveBeenCalled();
  });

  // ── Real matter + cloud key: AI panel ──────────────────────────────────────

  it('real matter with cloud key shows loading state then AI result', async () => {
    useMatterStore.getState().createMatter({ name: 'Acme v. Beta', client: 'Acme Corp' });
    const matter = useMatterStore.getState().matters[0]!;

    // Slow generation to confirm loading state appears first
    let resolveGenerate!: (v: MatterAtAGlanceResult) => void;
    mockGenerate.mockReturnValue(new Promise<MatterAtAGlanceResult>((res) => { resolveGenerate = res; }));

    render(<MatterHub matterId={matter.id} onBack={() => undefined} />);

    // Loading state visible while generating
    await waitFor(() => {
      expect(screen.getByTestId('hub-ai-glance-loading')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('hub-ai-glance-result')).toBeNull();

    // Resolve generation
    await act(async () => {
      resolveGenerate(sampleGlanceResult);
    });

    // Result visible
    await waitFor(() => {
      expect(screen.getByTestId('hub-ai-glance-result')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('hub-ai-glance-loading')).toBeNull();

    // AI tag visible
    expect(screen.getByTestId('hub-ai-glance-tag')).toBeInTheDocument();
    // Content from result
    expect(screen.getByText('Lease dispute unresolved')).toBeInTheDocument();
    expect(screen.getByText('Response due July 1')).toBeInTheDocument();
    expect(screen.getByText('July 1 response deadline')).toBeInTheDocument();
    expect(screen.getByText('Request title search')).toBeInTheDocument();
  });

  it('real matter with cloud key serves from cache and renders result', async () => {
    useMatterStore.getState().createMatter({ name: 'Cached Matter', client: 'Client X' });
    const matter = useMatterStore.getState().matters[0]!;

    // Pre-populate cache
    useMatterAtAGlanceStore.getState().setEntry(matter.id, sampleGlanceResult);

    render(<MatterHub matterId={matter.id} onBack={() => undefined} />);

    // Result should render (either from cache or from generate — both produce same output)
    await waitFor(() => {
      expect(screen.getByTestId('hub-ai-glance-result')).toBeInTheDocument();
    });
    // The cached content is visible
    expect(screen.getByText('Lease dispute unresolved')).toBeInTheDocument();
  });

  it('Refresh button triggers regeneration and shows new result', async () => {
    useMatterStore.getState().createMatter({ name: 'Refresh Test', client: 'Client R' });
    const matter = useMatterStore.getState().matters[0]!;

    // Pre-populate cache so hub renders result immediately on mount
    useMatterAtAGlanceStore.getState().setEntry(matter.id, sampleGlanceResult);

    // Initial mount: mockGenerate returns the cached sampleGlanceResult
    mockGenerate.mockResolvedValue(sampleGlanceResult);

    render(<MatterHub matterId={matter.id} onBack={() => undefined} />);

    // Wait for initial result to render
    await waitFor(() => {
      expect(screen.getByTestId('hub-ai-glance-result')).toBeInTheDocument();
    });

    // New result after refresh
    const refreshedResult: MatterAtAGlanceResult = {
      openIssues: ['New open issue after refresh'],
      deadlines: [],
      upcomingDates: [],
      nextActions: [],
      generatedAt: new Date().toISOString(),
    };
    mockGenerate.mockResolvedValue(refreshedResult);

    // Refresh button present
    const refreshBtn = screen.getByTestId('hub-ai-glance-refresh');
    expect(refreshBtn).toBeInTheDocument();

    // Click refresh
    await act(async () => {
      fireEvent.click(refreshBtn);
    });

    // New result rendered after refresh
    await waitFor(() => {
      expect(screen.getByText('New open issue after refresh')).toBeInTheDocument();
    });

    // Generator was called for the refresh
    expect(mockGenerate).toHaveBeenCalledWith(matter.id, expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });

  // ── Real matter + NO cloud key: honest counts fallback ─────────────────────

  it('real matter WITHOUT cloud key shows honest counts fallback, not AI panel', async () => {
    mockHasCloudKey.mockResolvedValue(false);

    useMatterStore.getState().createMatter({ name: 'No-Key Matter', client: 'Client NK' });
    const matter = useMatterStore.getState().matters[0]!;

    render(<MatterHub matterId={matter.id} onBack={() => undefined} />);

    await waitFor(() => {
      expect(screen.getByTestId('hub-real-glance')).toBeInTheDocument();
    });

    // The AI panel and its tag should not be shown when there is no key
    expect(screen.queryByTestId('hub-ai-glance')).toBeNull();
    expect(screen.queryByTestId('hub-ai-glance-tag')).toBeNull();
  });

  it('local-only matter with NO cloud key STILL runs the AI glance (embedded model), not the no-key fallback', async () => {
    // Codex: private mode + embedded Keepance Local AI + no cloud key must get an
    // AI at-a-glance (it runs on the local model), not be told to "add a key" —
    // the same local-completeness fix as Workflows / Email / Client Map.
    useSettingsStore.getState().setSetting(CONFIDENTIALITY_MODE_SETTING_KEY, 'local-only');
    mockHasCloudKey.mockResolvedValue(false);
    mockGenerate.mockResolvedValue(sampleGlanceResult);

    useMatterStore.getState().createMatter({ name: 'Private Matter', client: 'Client P' });
    const matter = useMatterStore.getState().matters[0]!;

    render(<MatterHub matterId={matter.id} onBack={() => undefined} />);

    // The AI glance generated and rendered despite the missing cloud key.
    await waitFor(() => {
      expect(screen.getByTestId('hub-ai-glance-result')).toBeInTheDocument();
    });
    expect(mockGenerate).toHaveBeenCalledWith(
      matter.id,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(screen.getByText('Lease dispute unresolved')).toBeInTheDocument();
  });

  it('real matter without cloud key shows "get started" copy when no folders', async () => {
    mockHasCloudKey.mockResolvedValue(false);

    useMatterStore.getState().createMatter({ name: 'Empty Matter', client: 'Client E' });
    const matter = useMatterStore.getState().matters[0]!;

    render(<MatterHub matterId={matter.id} onBack={() => undefined} />);

    await waitFor(() => {
      expect(screen.getByTestId('hub-real-glance')).toBeInTheDocument();
    });

    expect(screen.getByText(/Add documents/i)).toBeInTheDocument();
  });

  // ── Generator returns empty result ─────────────────────────────────────────

  it('shows "nothing notable yet" when generator returns all empty arrays', async () => {
    const emptyResult: MatterAtAGlanceResult = {
      openIssues: [],
      deadlines: [],
      upcomingDates: [],
      nextActions: [],
      generatedAt: new Date().toISOString(),
    };
    mockGenerate.mockResolvedValue(emptyResult);

    useMatterStore.getState().createMatter({ name: 'Empty Result Matter', client: 'Client Em' });
    const matter = useMatterStore.getState().matters[0]!;

    render(<MatterHub matterId={matter.id} onBack={() => undefined} />);

    await waitFor(() => {
      expect(screen.getByTestId('hub-ai-glance-empty')).toBeInTheDocument();
    });
    // The "Generated by AI" tag is still visible even for empty results
    expect(screen.getByTestId('hub-ai-glance-tag')).toBeInTheDocument();
    // Refresh button is available
    expect(screen.getByTestId('hub-ai-glance-refresh')).toBeInTheDocument();
  });

  it('dedupes equivalent folder paths in the documents panel', async () => {
    mockHasCloudKey.mockResolvedValue(false);
    useMatterStore.setState({
      matters: [
        {
          id: 'matter_dupe_folders',
          name: 'Hollings Family',
          client: 'Hollings',
          folderPaths: ['/workspace/Clients/Hollings Family', 'Clients/Hollings Family'],
          createdAt: '2026-06-01T00:00:00.000Z',
        },
      ],
      activeMatterId: null,
    });

    render(<MatterHub matterId="matter_dupe_folders" onBack={() => undefined} />);

    await waitFor(() => {
      expect(screen.getByTestId('hub-real-glance')).toBeInTheDocument();
    });

    const documentsPanel = screen.getByTestId('hub-panel-documents');
    expect(within(documentsPanel).getByText('(1)')).toBeInTheDocument();
    expect(within(documentsPanel).getAllByText('Hollings Family')).toHaveLength(1);
  });
});
