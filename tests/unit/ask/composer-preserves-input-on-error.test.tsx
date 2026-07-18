/**
 * BUG-002 — Ask composer preserves typed question on AI query failure.
 *
 * When the AI provider throws (e.g. network error, bad key, provider
 * unreachable), the text the user typed into the Ask composer must NOT be
 * wiped. The user should be able to retry without re-typing their question.
 *
 * Root cause: useAsk.ts called `setQuestion('')` before the async try/catch,
 * so any failure in the try block left the input empty.
 *
 * Fix: only clear the composer after a SUCCESSFUL answer is committed.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

// ── Hoisted mocks ────────────────────────────────────────────────────────────
const mockSendMessage = vi.fn();
const mockGetKey = vi.fn().mockResolvedValue(null);
const mockInitSession = vi.fn();
const mockAddMessage = vi.fn();
const mockUpdateLastMessage = vi.fn();
const mockSessions: Record<string, { chatId: string; messages: unknown[]; isLoading: boolean; lastUpdated: string }> = {};

vi.mock('@/platform/rag/MemoryService', () => ({
  MemoryService: { retrieve: vi.fn().mockResolvedValue([]) },
  isMemoryEnabled: () => false,
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
      getKey: mockGetKey,
      hasKey: async (p: string) => Boolean(await mockGetKey(p)),
    };
  }),
}));

// Provider that rejects — simulates network error / bad key
vi.mock('@/platform/providers/OllamaProvider', () => ({
  OllamaProvider: vi.fn().mockImplementation(() => ({
    sendMessage: mockSendMessage,
    sendMessageStreaming: undefined,
    getMetadata: vi.fn().mockReturnValue({ provider: 'ollama', model: 'test' }),
  })),
}));

vi.mock('@/platform/providers/ClaudeProvider', () => ({
  ClaudeProvider: vi.fn().mockImplementation(() => ({
    sendMessage: mockSendMessage,
    sendMessageStreaming: undefined,
    getMetadata: vi.fn().mockReturnValue({ provider: 'anthropic', model: 'stub' }),
  })),
}));
vi.mock('@/platform/providers/OpenAIProvider', () => ({ OpenAIProvider: vi.fn() }));
vi.mock('@/platform/providers/GeminiProvider', () => ({ GeminiProvider: vi.fn() }));

vi.mock('@/platform/client-context', () => ({
  useSelectionOperationDecision: () => ({ kind: 'all-matters', client: null }),
  readSelectionOperationDecision: () => ({ kind: 'all-matters', client: null }),
}));
vi.mock('@/platform/matter/matterStore', () => ({
  useActiveMatter: () => null,
  SAMPLE_MATTER_ID: 'matter_sample_garcia_v_meridian',
}));

vi.mock('@/platform/fs/workspaceStore', () => {
  const wsState = { rootPath: null };
  const useWorkspaceStore = (selector: (s: { rootPath: string | null }) => unknown) => selector(wsState);
  useWorkspaceStore.getState = () => wsState;
  return { useWorkspaceStore };
});

vi.mock('@/platform/profile/professionStore', () => ({
  useProfessionStore: (selector: (s: { profession: string }) => unknown) =>
    selector({ profession: 'legal' }),
}));

vi.mock('@/platform/rag/matterResolver', () => ({
  matterLabel: (m: unknown) => String(m),
}));

vi.mock('@/platform/matter/samples/sampleMatterDemo', () => ({
  getDemoAnswerForWorkspace: vi.fn().mockReturnValue(null),
  getDemoQuestions: vi.fn().mockReturnValue([
    'Question 1', 'Question 2', 'Question 3', 'Question 4',
  ]),
}));

vi.mock('@/platform/privacy/ui/EgressIndicator', () => ({
  EgressIndicator: () => null,
}));

vi.mock('@/platform/hooks/useConfidentialityMode', () => ({
  getConfidentialityMode: () => 'local',
  useConfidentialityMode: () => 'local',
}));

vi.mock('@/platform/state/aiChatStore', () => {
  const hook = (selector: (s: unknown) => unknown) =>
    selector({
      initSession: mockInitSession,
      setSessionWorkspaceRoot: () => undefined,
      addMessage: mockAddMessage,
      updateLastMessage: mockUpdateLastMessage,
      sessions: mockSessions,
    });
  hook.getState = () => ({
    initSession: mockInitSession,
    addMessage: mockAddMessage,
    updateLastMessage: mockUpdateLastMessage,
    sessions: mockSessions,
  });
  return {
    useAIChatStore: hook,
    // F2.5 — Ask reads per-conversation file-access consent; granted (all-clients)
    // here so these tests still exercise the consented retrieval path.
    useFileAccessConsent: () => ({ state: "granted", grantedScope: { kind: "allMatters" } }),
    getFileAccessConsent: () => ({ state: "granted", grantedScope: { kind: "allMatters" } }),
  };
});

// ── Import subject under test ─────────────────────────────────────────────────
import { Ask } from '@/features/ask/Ask';

// ── Tests ─────────────────────────────────────────────────────────────────────
describe('BUG-002 — Ask composer preserves input on AI query failure', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetKey.mockResolvedValue(null);
    mockSendMessage.mockReset();
  });

  it('keeps the typed question in the composer after a provider error (RED → GREEN)', async () => {
    // Provider rejects — simulates unreachable server / bad API key
    mockSendMessage.mockRejectedValue(new Error('Network error: provider unreachable'));

    render(<Ask />);

    const input = screen.getByTestId('ask-composer-input') as HTMLInputElement;

    act(() => {
      fireEvent.change(input, { target: { value: 'What are the open issues?' } });
    });

    expect(input.value).toBe('What are the open issues?');

    // Submit via the Search button
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: /^Ask$/i }));
    });

    // Wait for the error state to settle (the hook sets status to 'error')
    await waitFor(() => {
      // status 'error' means the async path has completed
      expect(screen.getByTestId('ask-composer-input')).toBeInTheDocument();
    });

    // The input must still contain the question so the user can retry
    await waitFor(() => {
      expect((screen.getByTestId('ask-composer-input') as HTMLInputElement).value)
        .toBe('What are the open issues?');
    });
  });

  it('clears the composer after a SUCCESSFUL answer (regression guard)', async () => {
    mockSendMessage.mockResolvedValue({
      content: 'The open issues are: [brief answer]',
      usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
      cost: 0,
      model: 'stub',
    });

    render(<Ask />);

    const input = screen.getByTestId('ask-composer-input') as HTMLInputElement;

    act(() => {
      fireEvent.change(input, { target: { value: 'What are the open issues?' } });
    });

    act(() => {
      fireEvent.click(screen.getByRole('button', { name: /^Ask$/i }));
    });

    // After a successful send the input should be cleared
    await waitFor(() => {
      expect((screen.getByTestId('ask-composer-input') as HTMLInputElement).value).toBe('');
    });
  });
});
