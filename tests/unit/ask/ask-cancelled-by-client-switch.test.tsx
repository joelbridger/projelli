/**
 * QA-25 (P2) — submitting an Ask question then immediately switching to a
 * different client silently discarded the question: no error, no
 * "answering"/processing state, no history entry. The composer still showed
 * the typed text but the conversation area was blank, both immediately and
 * after an 8s wait (persona-C klutz exploration, lane qa4).
 *
 * Root cause (useAsk.ts): the whole exchange is only persisted to the store
 * at the END of `handleAsk` (after the answer is fully composed); a pending
 * question that hasn't gotten that far lives ONLY in local, per-mount state
 * (`streamingTurn`/`status`), which the chatId-switch effect unconditionally
 * resets to idle/null the moment you leave. Making the response seamlessly
 * complete in the background and rehydrate on return would require `turns`
 * to be reactively derived from the store instead of a once-per-mount
 * snapshot — real surgery on a consent-sensitive surface. The narrower,
 * honest fix (per the QA-25 brief): abort the in-flight request on switch and
 * leave an explicit, persisted "cancelled by switch" record in the ORIGINAL
 * client's own history — never silent loss.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { ASK_CANCELLED_BY_SWITCH_MESSAGE } from '@/features/ask/askPrompt';

const h = vi.hoisted(() => ({
  addMessage: vi.fn(),
  activeMatter: null as { id: string; name: string; client: string; folderPaths: string[] } | null,
  // The retrieval never settles for the duration of these tests — it models
  // a real in-flight question that hasn't come back yet when the user
  // switches clients.
  retrieve: vi.fn(() => new Promise<unknown[]>(() => { /* never resolves */ })),
}));

const EMILY = { id: 'matter_emily', name: 'Emily Chen Household', client: 'Emily Chen', folderPaths: ['/ws/Emily'] };
const GARCIA = { id: 'matter_garcia', name: 'Garcia Family Trust', client: 'Garcia Family', folderPaths: ['/ws/Garcia'] };

vi.mock('@/platform/rag/MemoryService', () => ({
  MemoryService: { retrieve: (...args: unknown[]) => h.retrieve(...args) },
  isMemoryEnabled: () => true,
}));

vi.mock('@/platform/rag/workspaceCommand', () => ({
  DEFAULT_WORKSPACE_TOP_K: 5,
  buildWorkspaceContextBlock: () => '',
  citationBasename: (p: string) => p,
  parseCitations: () => [],
  resolveCitationPath: () => null,
  filterHitsByScope: (hits: unknown[]) => hits,
}));

vi.mock('@/platform/providers/KeychainService', () => ({
  KeychainService: vi.fn().mockImplementation(function () {
    return { getKey: async () => null, hasKey: async () => false };
  }),
}));

vi.mock('@/platform/providers/ClaudeProvider', () => ({
  ClaudeProvider: vi.fn().mockImplementation(() => ({
    sendMessage: vi.fn(),
    sendMessageStreaming: undefined,
    getMetadata: vi.fn().mockReturnValue({ provider: 'anthropic', model: 'stub' }),
  })),
}));
vi.mock('@/platform/providers/OpenAIProvider', () => ({ OpenAIProvider: vi.fn() }));
vi.mock('@/platform/providers/GeminiProvider', () => ({ GeminiProvider: vi.fn() }));
vi.mock('@/platform/providers/OllamaProvider', () => ({ OllamaProvider: vi.fn() }));

vi.mock('@/platform/matter/matterStore', () => ({
  useActiveMatter: () => h.activeMatter,
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
  matterLabel: (m: { name: string }) => m.name,
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
  const sessions: Record<string, unknown> = {};
  const state = {
    initSession: (chatId: string, initialMessages: unknown[]) => {
      if (!sessions[chatId]) sessions[chatId] = { chatId, messages: initialMessages, isLoading: false };
    },
    setSessionWorkspaceRoot: () => undefined,
    addMessage: (chatId: string, message: unknown) => h.addMessage(chatId, message),
    sessions,
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

describe('QA-25 (P2): switching clients mid-Ask never silently discards the question', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.activeMatter = EMILY;
  });

  it('aborts the in-flight question and leaves an honest, persisted "cancelled by switch" record in the ORIGINAL client\'s history', () => {
    const { rerender } = render(<Ask />);

    const input = screen.getByTestId('ask-composer-input') as HTMLInputElement;
    act(() => {
      fireEvent.change(input, { target: { value: 'Is the Roth conversion done for this year?' } });
    });
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: /^Ask$/i }));
    });

    // The question is genuinely in flight (retrieval never resolves) — no
    // record persisted yet, matching "no history entry" from the bug report.
    expect(h.retrieve).toHaveBeenCalledTimes(1);
    expect(h.addMessage).not.toHaveBeenCalled();

    // Switch to a different client — the actual repro action.
    h.activeMatter = GARCIA;
    act(() => {
      rerender(<Ask />);
    });

    // The original client's history now has an honest record: the question
    // that was asked, and an explicit note that it wasn't answered because of
    // the switch — never silent loss.
    const emilyChatId = 'ask-matter_emily::/ws';
    expect(h.addMessage).toHaveBeenCalledWith(
      emilyChatId,
      expect.objectContaining({ role: 'user', content: 'Is the Roth conversion done for this year?' }),
    );
    expect(h.addMessage).toHaveBeenCalledWith(
      emilyChatId,
      expect.objectContaining({ role: 'assistant', content: ASK_CANCELLED_BY_SWITCH_MESSAGE }),
    );
  });

  it('does not write a cancellation record for a client switch when nothing was in flight', () => {
    const { rerender } = render(<Ask />);

    // No question submitted — just switch clients.
    h.activeMatter = GARCIA;
    act(() => {
      rerender(<Ask />);
    });

    expect(h.addMessage).not.toHaveBeenCalled();
  });
});
