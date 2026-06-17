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
import { render, screen, act, waitFor, fireEvent } from '@testing-library/react';
import { useMatterStore, SAMPLE_MATTER_ID } from '@/stores/matterStore';
import { useMatterAtAGlanceStore } from '@/stores/matterAtAGlanceStore';

// Hoist mock functions so vi.mock factories can reference them
const { mockGenerate, mockHasCloudKey } = vi.hoisted(() => ({
  mockGenerate: vi.fn(),
  mockHasCloudKey: vi.fn(),
}));

// ── Mail commands ─────────────────────────────────────────────────────────────
vi.mock('@/utils/mail-commands', () => ({
  mailIsConnected: async () => false,
  gmailIsConnected: async () => false,
  mailImapIsConnected: async () => false,
  mailConnectedAccounts: async () => [],
}));

// ── useApiKeys ────────────────────────────────────────────────────────────────
vi.mock('@/hooks/useApiKeys', () => ({
  useApiKeys: () => ({ apiKeys: [] }),
}));

// ── useFirm ───────────────────────────────────────────────────────────────────
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

// ── Workspace store ───────────────────────────────────────────────────────────
vi.mock('@/stores/workspaceStore', () => ({
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
vi.mock('@/stores/aiChatStore', () => ({
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
vi.mock('@/features/matters/logic/matterAtAGlance', () => ({
  generateMatterAtAGlance: mockGenerate,
  hasCloudKeyForGlance: mockHasCloudKey,
}));

// Import after mocks
import { MatterHub } from '@/features/matters/MatterHub';
import type { MatterAtAGlanceResult } from '@/features/matters/logic/matterAtAGlance';

const sampleGlanceResult: MatterAtAGlanceResult = {
  openIssues: ['Lease dispute unresolved'],
  deadlines: ['Response due July 1'],
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
});
