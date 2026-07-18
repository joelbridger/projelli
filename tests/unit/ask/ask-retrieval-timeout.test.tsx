/**
 * fix/ask-list-hang — the Ask pipeline must NEVER hang forever on retrieval.
 *
 * On a large workspace (~2,500 files) the LOCAL vector search behind an Ask
 * question (`MemoryService.retrieve` → LanceDB) could stall indefinitely, so the
 * frontend `await` at the retrieval step never settled: the "Answering…" spinner
 * span forever, no error, no network call, no recovery except killing the app.
 * It reproduced whether file-access consent was granted or denied, because the
 * retrieval runs unconditionally (consent only gates whether hits are injected).
 *
 * Guard: `withAskTimeout` bounds the retrieval. A stall rejects with an
 * AskTimeoutError, which the existing catch turns into the honest
 * `failedStage === 'retrieval'` "couldn't search your files yet — try again"
 * message, and the typed question is restored so the advisor can retry.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { ASK_RETRIEVAL_TIMEOUT_MS } from '@/features/ask/askTimeout';

// All mock state lives inside vi.hoisted so the (hoisted) vi.mock factories can
// reference it without hitting the temporal dead zone.
const h = vi.hoisted(() => ({
  sendMessage: vi.fn(),
  getKey: vi.fn<(p?: string) => Promise<unknown>>(),
  initSession: vi.fn(),
  addMessage: vi.fn(),
  sessions: {} as Record<string, unknown>,
  // The retrieval never settles — the exact stall the fix must bound.
  retrieve: vi.fn(
    (..._args: unknown[]) =>
      new Promise<unknown[]>(() => {
        /* intentionally never resolves */
      }),
  ),
}));

vi.mock('@/platform/rag/MemoryService', () => ({
  MemoryService: { retrieve: (...args: unknown[]) => h.retrieve(...args) },
  // Memory ON so the retrieval path actually runs (the whole point).
  isMemoryEnabled: () => true,
}));

vi.mock('@/platform/rag/workspaceCommand', () => ({
  DEFAULT_WORKSPACE_TOP_K: 5,
  buildWorkspaceContextBlock: () => '',
  citationBasename: (p: string) => p,
  parseCitations: () => [],
  resolveCitationPath: () => null,
  filterHitsByScope: (h: unknown[]) => h,
}));

vi.mock('@/platform/providers/KeychainService', () => ({
  KeychainService: vi.fn().mockImplementation(function () {
    return {
      getKey: h.getKey,
      hasKey: async (p: string) => Boolean(await h.getKey(p)),
    };
  }),
}));

vi.mock('@/platform/providers/ClaudeProvider', () => ({
  ClaudeProvider: vi.fn().mockImplementation(() => ({
    sendMessage: h.sendMessage,
    sendMessageStreaming: undefined,
    getMetadata: vi.fn().mockReturnValue({ provider: 'anthropic', model: 'stub' }),
  })),
}));
vi.mock('@/platform/providers/OpenAIProvider', () => ({ OpenAIProvider: vi.fn() }));
vi.mock('@/platform/providers/GeminiProvider', () => ({ GeminiProvider: vi.fn() }));
vi.mock('@/platform/providers/OllamaProvider', () => ({ OllamaProvider: vi.fn() }));

vi.mock('@/platform/client-context', () => ({
  useSelectionOperationDecision: () => ({ kind: 'all-matters', client: null }),
  readSelectionOperationDecision: () => ({ kind: 'all-matters', client: null }),
}));
vi.mock('@/platform/matter/matterStore', () => ({
  useActiveMatter: () => null,
  SAMPLE_MATTER_ID: 'matter_sample_garcia_v_meridian',
}));

vi.mock('@/platform/fs/workspaceStore', () => {
  const wsState = { rootPath: '/ws', rootGeneration: 1 };
  const useWorkspaceStore = (selector: (s: typeof wsState) => unknown) => selector(wsState);
  useWorkspaceStore.getState = () => wsState;
  return { useWorkspaceStore };
});

vi.mock('@/platform/profile/professionStore', () => ({
  useProfessionStore: (selector: (s: { profession: string }) => unknown) =>
    selector({ profession: 'advisor' }),
}));

vi.mock('@/platform/rag/matterResolver', () => ({
  matterLabel: (m: unknown) => String(m),
}));

vi.mock('@/platform/matter/samples/sampleMatterDemo', () => ({
  getDemoAnswerForWorkspace: vi.fn().mockReturnValue(null),
  getDemoQuestions: vi.fn().mockReturnValue(['Question 1', 'Question 2', 'Question 3', 'Question 4']),
}));

vi.mock('@/platform/privacy/ui/EgressIndicator', () => ({ EgressIndicator: () => null }));

vi.mock('@/platform/hooks/useConfidentialityMode', () => ({
  getConfidentialityMode: () => 'local',
  useConfidentialityMode: () => 'local',
}));

vi.mock('@/platform/state/aiChatStore', () => {
  const state = {
    initSession: h.initSession,
    setSessionWorkspaceRoot: () => undefined,
    addMessage: h.addMessage,
    sessions: h.sessions,
  };
  const hook = (selector: (s: unknown) => unknown) => selector(state);
  hook.getState = () => state;
  return {
    useAIChatStore: hook,
    useFileAccessConsent: () => ({ state: 'granted', grantedScope: { kind: 'allMatters' } }),
    getFileAccessConsent: () => ({ state: 'granted', grantedScope: { kind: 'allMatters' } }),
  };
});

import { Ask } from '@/features/ask/Ask';

describe('fix/ask-list-hang — retrieval hard timeout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.getKey.mockResolvedValue(null);
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('a never-resolving retrieval fails HONESTLY (retry message) instead of hanging forever', async () => {
    render(<Ask />);

    const input = screen.getByTestId('ask-composer-input') as HTMLInputElement;
    act(() => {
      fireEvent.change(input, { target: { value: 'Which client is doing a 1031 exchange?' } });
    });
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: /^Ask$/i }));
    });

    // The retrieval was actually invoked (this is the unconditional stall path).
    expect(h.retrieve).toHaveBeenCalledTimes(1);

    // BEFORE the timeout fires: no honest error yet (it is genuinely "answering").
    expect(document.body.textContent).not.toContain("couldn't search your files yet");

    // Advance past the hard timeout — the stall must now resolve to an honest,
    // retryable failure rather than an infinite spinner.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ASK_RETRIEVAL_TIMEOUT_MS + 50);
    });

    // Honest, plain-language retry message is shown (the retrieval-stage copy).
    expect(document.body.textContent).toContain("I couldn't search your files yet");
    // The typed question is restored so the advisor can retry without re-typing.
    expect((screen.getByTestId('ask-composer-input') as HTMLInputElement).value).toBe(
      'Which client is doing a 1031 exchange?',
    );
    // The spinner is gone — the pipeline reached a terminal state, not a hang.
    expect(screen.queryByText(/Answering/i)).not.toBeInTheDocument();
  });
});
