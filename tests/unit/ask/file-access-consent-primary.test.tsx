/**
 * F2.5b — file-access consent on the PRIMARY Ask surface (bench R21 HIGH).
 *
 * The redesigned 3-tab-IA Ask surface (Ask.tsx + useAsk.ts) used to ship client
 * file content to a CLOUD provider on message one, with no banner and no way to
 * refuse — the consent gate was wired only into the legacy .aichat chat path.
 * These tests exercise the REAL Ask send path end-to-end and assert:
 *   - cloud + unasked/reconfirm → the provider is NOT called until the
 *     advisor answers the visible permission prompt;
 *   - cloud + denied           → a general answer may be sent without files;
 *   - cloud + granted          → file content is injected + fileToolsEnabled=true;
 *   - an all-clients turn is NOT covered by a single-client grant (scope-bound);
 *   - a LOCAL engine is never gated (file content flows without consent);
 *   - the consent banner renders on Ask for a cloud provider, hidden for local.
 *
 * The pure decision functions are covered in file-access-retrieval-gate.test.ts;
 * this is the wiring proof the bench asked for.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { AuditEntry } from '@/platform/types/audit';
import type { RagHit } from '@/platform/utils/tauri-commands';
import type { FileAccessConsent } from '@/platform/ai/fileAccessConsent';

const FILE_CONTENT = 'The client wants to retire in 2032 and hold 60% equities.';

const h = vi.hoisted(() => ({
  retrieve: vi.fn<(...a: unknown[]) => Promise<unknown[]>>(),
  cloudSend: vi.fn<(q: string, opts: { systemPrompt?: string }) => Promise<unknown>>(),
  localSend: vi.fn<(q: string, opts: { systemPrompt?: string }) => Promise<unknown>>(),
  capturedCloudPrompt: '' as string,
  capturedLocalPrompt: '' as string,
  initSession: vi.fn(),
  addMessage: vi.fn(),
  sessions: {} as Record<string, unknown>,
  consent: { state: 'unasked' } as FileAccessConsent,
  activeMatter: null as { id: string; name: string; client: string } | null,
  hasCloudKey: true,
  localAvailable: false,
  // Render-time workspace root (drives the send's closure) vs. the LIVE root read
  // by the in-flight race guard (useWorkspaceStore.getState()). Equal by default;
  // differ them to simulate a workspace switch mid-send.
  rootPath: '/workspace' as string | null,
  liveRootPath: '/workspace' as string | null,
  // Monotonic workspace generation read by the in-flight race guard. Bump it to
  // simulate a workspace switch (incl. an A→B→A round-trip) mid-send.
  rootGen: 0,
}));

vi.mock('@/i18n', () => ({ default: { t: (k: string) => k } }));

vi.mock('@/platform/client-context', () => ({
  useSelectionOperationDecision: () => h.activeMatter
    ? { kind: 'matter' as const, sourceKind: 'matter-only' as const, matter: h.activeMatter, client: null }
    : { kind: 'all-matters' as const, client: null },
  readSelectionOperationDecision: () => h.activeMatter
    ? { kind: 'matter' as const, sourceKind: 'matter-only' as const, matter: h.activeMatter, client: null }
    : { kind: 'all-matters' as const, client: null },
}));
vi.mock('@/platform/matter/matterStore', () => ({
  useActiveMatter: () => h.activeMatter,
  SAMPLE_MATTER_ID: 'matter_sample_garcia_v_meridian',
}));

vi.mock('@/platform/fs/workspaceStore', () => {
  const useWorkspaceStore = (selector: (s: { rootPath: string | null }) => unknown) =>
    selector({ rootPath: h.rootPath });
  useWorkspaceStore.getState = () => ({ rootPath: h.liveRootPath, rootGeneration: h.rootGen });
  return { useWorkspaceStore };
});

vi.mock('@/platform/profile/professionStore', () => ({
  useProfessionStore: (selector: (s: { profession: string }) => unknown) =>
    selector({ profession: 'advisor' }),
  getProfession: () => 'advisor',
}));

vi.mock('@/platform/rag/matterResolver', () => ({
  matterLabel: (m: { name?: string } | null) => m?.name ?? 'all',
}));

vi.mock('@/platform/matter/samples/sampleMatterDemo', () => ({
  getDemoAnswerForWorkspace: vi.fn().mockReturnValue(null),
  getDemoQuestions: vi.fn().mockReturnValue(['q1', 'q2', 'q3', 'q4']),
}));

vi.mock('@/platform/privacy/ui/EgressIndicator', () => ({
  EgressIndicator: () => null,
}));

vi.mock('@/platform/hooks/useConfidentialityMode', () => ({
  getConfidentialityMode: () => 'direct',
  useConfidentialityMode: () => 'direct',
}));

vi.mock('@/platform/privacy/localOnlyGuard', async (orig) => {
  const real = await orig<typeof import('@/platform/privacy/localOnlyGuard')>();
  return { ...real, assertCloudGenerationAllowed: vi.fn() };
});

vi.mock('@/platform/rag/MemoryService', () => ({
  MemoryService: { retrieve: (...args: unknown[]) => h.retrieve(...args) },
  isMemoryEnabled: () => true,
}));

// Cloud provider (Claude) captures the system prompt it is asked to send.
vi.mock('@/platform/providers/ClaudeProvider', () => ({
  ClaudeProvider: class {
    sendMessageStreaming = undefined;
    sendMessage = (q: string, opts: { systemPrompt?: string }) => {
      h.capturedCloudPrompt = opts.systemPrompt ?? '';
      return h.cloudSend(q, opts);
    };
    getMetadata() { return { model: 'claude-consent-stub' }; }
  },
}));
vi.mock('@/platform/providers/OpenAIProvider', () => ({ OpenAIProvider: class {} }));
vi.mock('@/platform/providers/GeminiProvider', () => ({ GeminiProvider: class {} }));
vi.mock('@/platform/providers/OllamaProvider', () => ({ OllamaProvider: class {} }));

// Local (on-device) engine used for the "local is never gated" case. Reached via
// buildResolvedAskProvider's no-cloud-key fallback (resolveAvailableLocal…).
vi.mock('@/platform/providers/resolveLocalProvider', () => ({
  resolveLocalGenerationProvider: vi.fn(async () => localResolved()),
  resolveAvailableLocalGenerationProvider: vi.fn(async () =>
    h.localAvailable ? localResolved() : null,
  ),
}));
function localResolved() {
  return {
    provider: {
      sendMessageStreaming: undefined,
      sendMessage: (q: string, opts: { systemPrompt?: string }) => {
        h.capturedLocalPrompt = opts.systemPrompt ?? '';
        return h.localSend(q, opts);
      },
      getMetadata: () => ({ model: 'lantern-local-stub' }),
    },
    providerId: 'lantern-local' as const,
    model: 'lantern-local-stub',
  };
}

vi.mock('@/platform/providers/KeychainService', () => ({
  KeychainService: vi.fn().mockImplementation(function () {
    return {
      getKey: (p: string) =>
        Promise.resolve(h.hasCloudKey && p === 'anthropic' ? 'sk-ant-test' : null),
      hasKey: (p: string) => Promise.resolve(h.hasCloudKey && p === 'anthropic'),
    };
  }),
}));

vi.mock('@/platform/state/aiChatStore', () => {
  const state = {
    initSession: h.initSession,
    setSessionWorkspaceRoot: () => undefined,
    addMessage: h.addMessage,
    sessions: h.sessions,
    setFileAccessConsent: () => undefined,
  };
  const hook = (selector: (s: unknown) => unknown) => selector(state);
  hook.getState = () => state;
  return {
    useAIChatStore: hook,
    useFileAccessConsent: () => h.consent,
    getFileAccessConsent: () => h.consent,
  };
});

import { Ask } from '@/features/ask/Ask';

type LoggedEntry = Omit<AuditEntry, 'id' | 'timestamp'>;

function egressEntry(entries: LoggedEntry[]): LoggedEntry | undefined {
  return entries.find((e) => e.metadata['auditEventType'] === 'egress');
}

async function ask(consent: FileAccessConsent, opts?: {
  activeMatter?: { id: string; name: string; client: string } | null;
  hasCloudKey?: boolean;
  localAvailable?: boolean;
}) {
  h.consent = consent;
  h.activeMatter = opts?.activeMatter ?? null;
  h.hasCloudKey = opts?.hasCloudKey ?? true;
  h.localAvailable = opts?.localAvailable ?? false;
  const logged: LoggedEntry[] = [];
  render(<Ask onAuditLog={(entry) => logged.push(entry)} />);
  fireEvent.change(screen.getByTestId('ask-composer-input'), {
    target: { value: 'When does the client want to retire?' },
  });
  fireEvent.click(screen.getByRole('button', { name: /^Ask$/i }));
  return logged;
}

const GRANT_ALL: FileAccessConsent = { state: 'granted', grantedScope: { kind: 'allMatters' } };
const MATTER = { id: 'matter_ellison', name: 'Ellison', client: 'Ellison Family' };

describe('F2.5b — Ask primary-surface consent gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.sessions = {};
    h.capturedCloudPrompt = '';
    h.capturedLocalPrompt = '';
    h.rootPath = '/workspace';
    h.liveRootPath = '/workspace';
    h.rootGen = 0;
    h.retrieve.mockResolvedValue([
      { path: '/workspace/plan.pdf', chunkText: FILE_CONTENT, score: 0.95, paragraphIndex: 2, id: 'c1', sourceType: 'pdf' } as RagHit,
    ]);
    h.cloudSend.mockResolvedValue({
      content: 'A general answer with no citation.',
      usage: { inputTokens: 5, outputTokens: 5 }, cost: 0.0001, model: 'claude-consent-stub',
    });
    h.localSend.mockResolvedValue({
      content: `Grounded [plan.pdf paragraph 2].`,
      usage: { inputTokens: 5, outputTokens: 5 }, cost: 0, model: 'lantern-local-stub',
    });
  });

  it('cloud + UNASKED → blocks the send and keeps the permission prompt visible', async () => {
    const logged = await ask({ state: 'unasked' });
    await waitFor(() => expect(screen.getByTestId('ask-composer-input')).toHaveValue(
      'When does the client want to retire?',
    ));
    expect(h.cloudSend).not.toHaveBeenCalled();
    expect(egressEntry(logged)).toBeUndefined();
    expect(screen.getByTestId('chat-file-access-consent')).toHaveAttribute('data-state', 'unasked');
  });

  it('cloud + DENIED → no file content in the cloud prompt; egress fileToolsEnabled=false', async () => {
    const logged = await ask({ state: 'denied' });
    await waitFor(() => expect(h.cloudSend).toHaveBeenCalledTimes(1));
    expect(h.capturedCloudPrompt).not.toContain('retire in 2032');
    expect(egressEntry(logged)?.metadata['fileToolsEnabled']).toBe(false);
  });

  it('cloud + GRANTED (all clients) → file content IS injected; egress fileToolsEnabled=true', async () => {
    const logged = await ask(GRANT_ALL);
    await waitFor(() => expect(h.cloudSend).toHaveBeenCalledTimes(1));
    expect(h.capturedCloudPrompt).toContain('retire in 2032');
    expect(egressEntry(logged)?.metadata['fileToolsEnabled']).toBe(true);
  });

  it('all-clients turn is NOT covered by a single-client grant → asks to reconfirm before sending', async () => {
    // Grant is bound to one client; the turn (no active matter) spans all clients.
    const singleClientGrant: FileAccessConsent = {
      state: 'granted', grantedScope: { kind: 'matter', matterId: 'matter_ellison' },
    };
    const logged = await ask(singleClientGrant, { activeMatter: null });
    await waitFor(() => expect(screen.getByTestId('ask-composer-input')).toHaveValue(
      'When does the client want to retire?',
    ));
    expect(h.cloudSend).not.toHaveBeenCalled();
    expect(egressEntry(logged)).toBeUndefined();
    expect(screen.getByTestId('chat-file-access-consent')).toHaveAttribute('data-state', 'reconfirm');
  });

  it('single-client GRANT covers that same client → file content injected', async () => {
    const singleClientGrant: FileAccessConsent = {
      state: 'granted', grantedScope: { kind: 'matter', matterId: MATTER.id },
    };
    await ask(singleClientGrant, { activeMatter: MATTER });
    await waitFor(() => expect(h.cloudSend).toHaveBeenCalledTimes(1));
    expect(h.capturedCloudPrompt).toContain('retire in 2032');
  });

  it('LOCAL engine is never gated → file content flows even with UNASKED consent', async () => {
    await ask({ state: 'unasked' }, { hasCloudKey: false, localAvailable: true });
    await waitFor(() => expect(h.localSend).toHaveBeenCalledTimes(1));
    expect(h.cloudSend).not.toHaveBeenCalled();
    expect(h.capturedLocalPrompt).toContain('retire in 2032');
  });

  it('BUG-01: switching from Local AI to Cloud AI waits for permission, then sends the same files with citations', async () => {
    h.consent = { state: 'unasked' };
    h.hasCloudKey = false;
    h.localAvailable = true;
    const view = render(<Ask />);

    fireEvent.change(screen.getByTestId('ask-composer-input'), {
      target: { value: 'When does the client want to retire?' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^Ask$/i }));
    await waitFor(() => expect(h.localSend).toHaveBeenCalledTimes(1));
    expect(h.capturedLocalPrompt).toContain('retire in 2032');

    await waitFor(() => expect(screen.getByTestId('ask-composer-input')).not.toBeDisabled());
    h.hasCloudKey = true;
    h.localAvailable = false;
    fireEvent.change(screen.getByTestId('ask-composer-input'), {
      target: { value: 'When does the client want to retire?' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^Ask$/i }));

    await waitFor(() => expect(screen.getByTestId('ask-composer-input')).not.toBeDisabled());
    expect(h.cloudSend).not.toHaveBeenCalled();
    expect(screen.getByTestId('ask-composer-input')).toHaveValue(
      'When does the client want to retire?',
    );
    expect(screen.getByTestId('chat-file-access-consent')).toHaveAttribute(
      'data-state',
      'unasked',
    );

    h.consent = GRANT_ALL;
    h.cloudSend.mockResolvedValue({
      content: '[[BLOCK:FILES]]\nThe client wants to retire in 2032 [plan.pdf paragraph 2].',
      usage: { inputTokens: 5, outputTokens: 5 }, cost: 0.0001, model: 'claude-consent-stub',
    });
    view.rerender(<Ask />);
    fireEvent.click(screen.getByRole('button', { name: /^Ask$/i }));

    await waitFor(() => expect(h.cloudSend).toHaveBeenCalledTimes(1));
    expect(h.capturedCloudPrompt).toContain('retire in 2032');
    await waitFor(() => {
      const savedCloudCitation = h.addMessage.mock.calls.some((call) => {
        const message = call[1] as {
          role?: string;
          askProviderId?: string;
          askCitations?: unknown[];
        } | undefined;
        return message?.role === 'assistant' &&
          message.askProviderId === 'anthropic' &&
          message.askCitations?.length === 1;
      });
      expect(savedCloudCitation).toBe(true);
    });
  });

  it('P1 (Codex): revoking consent mid-conversation redacts prior file-grounded history from the next cloud prompt', async () => {
    // Files-only mode makes the citation binding deterministic (flat cited path).
    localStorage.setItem('lantern:ask-files-only', '1');
    try {
      h.cloudSend.mockResolvedValue({
        content: 'The client wants to retire in 2032 [plan.pdf paragraph 2].',
        usage: { inputTokens: 5, outputTokens: 5 }, cost: 0.0001, model: 'claude-consent-stub',
      });
      h.consent = GRANT_ALL;
      h.hasCloudKey = true;
      render(<Ask />);
      // Turn 1 — consent granted → a real file-grounded answer lands in history.
      fireEvent.change(screen.getByTestId('ask-composer-input'), { target: { value: 'When does the client retire?' } });
      fireEvent.click(screen.getByRole('button', { name: /^Ask$/i }));
      await waitFor(() => expect(h.cloudSend).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(screen.getAllByText(/retire in 2032/i).length).toBeGreaterThan(0));

      // Turn 2 — user REVOKES file access, then asks again.
      h.consent = { state: 'denied' };
      await waitFor(() => expect(screen.getByTestId('ask-composer-input')).not.toBeDisabled());
      fireEvent.change(screen.getByTestId('ask-composer-input'), { target: { value: 'And their risk tolerance?' } });
      fireEvent.click(screen.getByRole('button', { name: /^Ask$/i }));
      await waitFor(() => expect(h.cloudSend).toHaveBeenCalledTimes(2));

      // The second cloud prompt must carry NEITHER a fresh workspace block NOR the
      // prior file-grounded answer via conversation history.
      expect(h.capturedCloudPrompt).not.toContain('retire in 2032');
    } finally {
      localStorage.removeItem('lantern:ask-files-only');
    }
  });

  it('P1 control: while consent stays granted, prior answers DO carry in history (proves the redaction is load-bearing)', async () => {
    localStorage.setItem('lantern:ask-files-only', '1');
    try {
      h.cloudSend.mockResolvedValue({
        content: 'The client wants to retire in 2032 [plan.pdf paragraph 2].',
        usage: { inputTokens: 5, outputTokens: 5 }, cost: 0.0001, model: 'claude-consent-stub',
      });
      h.consent = GRANT_ALL;
      h.hasCloudKey = true;
      render(<Ask />);
      fireEvent.change(screen.getByTestId('ask-composer-input'), { target: { value: 'When does the client retire?' } });
      fireEvent.click(screen.getByRole('button', { name: /^Ask$/i }));
      await waitFor(() => expect(h.cloudSend).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(screen.getAllByText(/retire in 2032/i).length).toBeGreaterThan(0));

      await waitFor(() => expect(screen.getByTestId('ask-composer-input')).not.toBeDisabled());
      fireEvent.change(screen.getByTestId('ask-composer-input'), { target: { value: 'And their risk tolerance?' } });
      fireEvent.click(screen.getByRole('button', { name: /^Ask$/i }));
      await waitFor(() => expect(h.cloudSend).toHaveBeenCalledTimes(2));

      // Consent still granted → the prior answer legitimately rides along in history.
      expect(h.capturedCloudPrompt).toContain('retire in 2032');
    } finally {
      localStorage.removeItem('lantern:ask-files-only');
    }
  });

  it('P1 durable marker (Codex round 2): a grounded-but-UNCITED prior answer is still redacted when consent is revoked', async () => {
    // Smart mode (default): the first answer carries client file content but NO
    // citation marker, so it lands in history with citations=[] and no files
    // block — the citation heuristic alone would keep it. The durable
    // groundedFromFiles marker (set because retrieval fed the turn) is what
    // redacts it on the later denied send.
    h.cloudSend.mockResolvedValue({
      content: 'The client currently holds 60% equities across their accounts.',
      usage: { inputTokens: 5, outputTokens: 5 }, cost: 0.0001, model: 'claude-consent-stub',
    });
    h.consent = GRANT_ALL;
    h.hasCloudKey = true;
    render(<Ask />);
    fireEvent.change(screen.getByTestId('ask-composer-input'), { target: { value: 'What is their equity allocation?' } });
    fireEvent.click(screen.getByRole('button', { name: /^Ask$/i }));
    await waitFor(() => expect(h.cloudSend).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getAllByText(/60% equities/i).length).toBeGreaterThan(0));

    h.consent = { state: 'denied' };
    await waitFor(() => expect(screen.getByTestId('ask-composer-input')).not.toBeDisabled());
    fireEvent.change(screen.getByTestId('ask-composer-input'), { target: { value: 'And bonds?' } });
    fireEvent.click(screen.getByRole('button', { name: /^Ask$/i }));
    await waitFor(() => expect(h.cloudSend).toHaveBeenCalledTimes(2));

    expect(h.capturedCloudPrompt).not.toContain('60% equities');
  });

  it('P1 transitive (Codex round 4): a follow-up that repeats file facts from history (no fresh hits) is redacted after consent is revoked', async () => {
    // Turn 1 retrieves a hit; turns 2+ retrieve nothing (the "summarize what you
    // just said" shape) yet still repeat the client fact from history.
    h.retrieve.mockReset();
    h.retrieve.mockResolvedValueOnce([
      { path: '/workspace/plan.pdf', chunkText: FILE_CONTENT, score: 0.95, paragraphIndex: 2, id: 'c1', sourceType: 'pdf' } as RagHit,
    ]);
    h.retrieve.mockResolvedValue([]);
    h.cloudSend.mockResolvedValue({
      content: 'Per your files, the client wants to retire in 2032.',
      usage: { inputTokens: 5, outputTokens: 5 }, cost: 0.0001, model: 'claude-consent-stub',
    });
    h.consent = GRANT_ALL;
    h.hasCloudKey = true;
    render(<Ask />);

    // Turn 1 — grounded fresh.
    fireEvent.change(screen.getByTestId('ask-composer-input'), { target: { value: 'When do they retire?' } });
    fireEvent.click(screen.getByRole('button', { name: /^Ask$/i }));
    await waitFor(() => expect(h.cloudSend).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getAllByText(/retire in 2032/i).length).toBeGreaterThan(0));

    // Turn 2 — STILL consented, NO fresh hits, but repeats the fact from history
    // → must be recorded as transitively file-derived (not "general").
    await waitFor(() => expect(screen.getByTestId('ask-composer-input')).not.toBeDisabled());
    fireEvent.change(screen.getByTestId('ask-composer-input'), { target: { value: 'Summarize what you just said.' } });
    fireEvent.click(screen.getByRole('button', { name: /^Ask$/i }));
    await waitFor(() => expect(h.cloudSend).toHaveBeenCalledTimes(2));

    // Turn 3 — consent REVOKED. Both the fresh-grounded turn 1 AND the
    // transitively-grounded turn 2 must be redacted from history.
    h.consent = { state: 'denied' };
    await waitFor(() => expect(screen.getByTestId('ask-composer-input')).not.toBeDisabled());
    fireEvent.change(screen.getByTestId('ask-composer-input'), { target: { value: 'Unrelated question.' } });
    fireEvent.click(screen.getByRole('button', { name: /^Ask$/i }));
    await waitFor(() => expect(h.cloudSend).toHaveBeenCalledTimes(3));

    expect(h.capturedCloudPrompt).not.toContain('retire in 2032');
  });

  it('P1 TOCTOU (Codex round 6): revoking consent DURING the async send window blocks file content', async () => {
    // Granted at click time, but the user hits "Turn off" while retrieval/provider
    // resolution is still awaiting. The gate re-reads consent at the last sync
    // moment, so no fresh file content reaches the cloud.
    h.consent = GRANT_ALL;
    h.hasCloudKey = true;
    render(<Ask />);
    fireEvent.change(screen.getByTestId('ask-composer-input'), { target: { value: 'What is their allocation?' } });
    fireEvent.click(screen.getByRole('button', { name: /^Ask$/i }));
    // Revoke synchronously, before any of handleAsk's awaits have resolved.
    h.consent = { state: 'denied' };
    await waitFor(() => expect(h.cloudSend).toHaveBeenCalledTimes(1));
    expect(h.capturedCloudPrompt).not.toContain('retire in 2032');
  });

  it('P1 in-flight race (Codex round 10/11): an A→B→A workspace switch DURING the send blocks cross-workspace content', async () => {
    // Send starts in /workspace (generation 0) with a grant; the workspace
    // round-trips A→B→A while retrieval/provider resolution is awaiting — the root
    // STRING ends up equal, but the monotonic generation advanced, so the guard
    // bails before the send. No content reaches the cloud under the wrong grant.
    h.consent = GRANT_ALL;
    h.hasCloudKey = true;
    render(<Ask />);
    fireEvent.change(screen.getByTestId('ask-composer-input'), { target: { value: 'What is their allocation?' } });
    fireEvent.click(screen.getByRole('button', { name: /^Ask$/i }));
    // A→B→A: the live root returns to '/workspace' but the generation moved on.
    h.liveRootPath = '/workspace';
    h.rootGen = 2;
    await new Promise((r) => setTimeout(r, 50));
    expect(h.cloudSend).not.toHaveBeenCalled();
  });

  it('P2 window (final review): an OLD file-grounded turn OUTSIDE the 6-turn prompt window does not mark the new answer file-derived', async () => {
    // 7 prior pairs: pair 1 is file-grounded (all-clients); pairs 2-7 are general.
    // The prompt only carries the last 6 (pairs 2-7), so the new answer must NOT be
    // audited fileToolsEnabled=true off the out-of-window pair 1, and the secret
    // must not appear in the prompt.
    const pairs: unknown[] = [
      { role: 'user', content: 'q1', timestamp: 't' },
      { role: 'assistant', content: 'CLIENT SECRET FACT', timestamp: 't', askGroundedFromFiles: true, askGroundingScope: { kind: 'allMatters' } },
    ];
    for (let i = 2; i <= 7; i++) {
      pairs.push({ role: 'user', content: `q${i}`, timestamp: 't' });
      pairs.push({ role: 'assistant', content: `general answer ${i}`, timestamp: 't', askGroundedFromFiles: false });
    }
    h.sessions = { 'ask-global::/workspace': { messages: pairs } } as Record<string, unknown>;
    h.retrieve.mockReset();
    h.retrieve.mockResolvedValue([]); // no fresh hits for the new question
    h.consent = GRANT_ALL;
    h.hasCloudKey = true;
    const logged: LoggedEntry[] = [];
    render(<Ask onAuditLog={(e) => logged.push(e)} />);
    fireEvent.change(screen.getByTestId('ask-composer-input'), { target: { value: 'anything new' } });
    fireEvent.click(screen.getByRole('button', { name: /^Ask$/i }));
    await waitFor(() => expect(h.cloudSend).toHaveBeenCalledTimes(1));
    expect(h.capturedCloudPrompt).not.toContain('CLIENT SECRET FACT');
    expect(egressEntry(logged)?.metadata['fileToolsEnabled']).toBe(false);
  });

  it('P2 non-file paths (final review): a no-evidence decline is stamped groundedFromFiles=false (not fail-closed)', async () => {
    localStorage.setItem('lantern:ask-files-only', '1'); // files-only → decline on zero hits
    try {
      h.retrieve.mockReset();
      h.retrieve.mockResolvedValue([]); // zero hits → no-evidence decline
      h.consent = GRANT_ALL;
      h.hasCloudKey = true;
      render(<Ask />);
      fireEvent.change(screen.getByTestId('ask-composer-input'), { target: { value: 'something not in the files' } });
      fireEvent.click(screen.getByRole('button', { name: /^Ask$/i }));
      // The decline path persists the assistant message with a DEFINITE false marker.
      await waitFor(() => {
        const declined = h.addMessage.mock.calls.some((call) => {
          const msg = call[1] as { role?: string; askGroundedFromFiles?: boolean } | undefined;
          return msg?.role === 'assistant' && msg?.askGroundedFromFiles === false;
        });
        expect(declined).toBe(true);
      });
      // And no cloud send happened (files-only decline short-circuits).
      expect(h.cloudSend).not.toHaveBeenCalled();
    } finally {
      localStorage.removeItem('lantern:ask-files-only');
    }
  });

  it('renders the consent banner on Ask for a cloud provider (unasked)', async () => {
    h.consent = { state: 'unasked' };
    h.hasCloudKey = true;
    render(<Ask />);
    await waitFor(() => {
      expect(screen.getByTestId('chat-file-access-consent')).toBeTruthy();
    });
    expect(screen.getByTestId('chat-file-access-consent').getAttribute('data-state')).toBe('unasked');
  });
});
