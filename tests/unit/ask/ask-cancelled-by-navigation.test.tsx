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
 * honest fix (per the QA-25 brief): abort the in-flight request on
 * navigation and leave an explicit, persisted "cancelled" record in the
 * ORIGINAL conversation's own history — never silent loss.
 *
 * The cleanup fires on ANY `chatId` change, not just a client switch — the
 * "New question" button and loading a different saved thread change chatId
 * the same way while staying on the same client (Codex review caught this),
 * so the persisted message is worded around "this conversation" rather than
 * naming a client switch specifically.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { ASK_CANCELLED_BY_NAVIGATION_MESSAGE } from '@/features/ask/askPrompt';

const h = vi.hoisted(() => ({
  addMessage: vi.fn(),
  activeMatter: null as { id: string; name: string; client: string; folderPaths: string[] } | null,
  // The retrieval never settles for the duration of these tests — it models
  // a real in-flight question that hasn't come back yet when the user
  // switches clients.
  retrieve: vi.fn((...args: unknown[]) => {
    void args;
    return new Promise<unknown[]>(() => { /* never resolves */ });
  }),
  // QA-25 (P1, Codex re-review) — controllable provider resolution, so a test
  // can trigger a navigation-cancel WHILE this specific await is pending (a
  // gap the fix at useAsk.ts's buildResolvedAskProvider() call closes).
  buildResolvedAskProvider: vi.fn(),
  sendMessage: vi.fn(),
  assertLocalOnlyAllowsSend: vi.fn(),
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
    sendMessage: h.sendMessage,
    sendMessageStreaming: undefined,
    getMetadata: vi.fn().mockReturnValue({ provider: 'anthropic', model: 'stub' }),
  })),
}));
vi.mock('@/platform/providers/OpenAIProvider', () => ({ OpenAIProvider: vi.fn() }));
vi.mock('@/platform/providers/GeminiProvider', () => ({ GeminiProvider: vi.fn() }));
vi.mock('@/platform/providers/OllamaProvider', () => ({ OllamaProvider: vi.fn() }));

// Partial mock: only override buildResolvedAskProvider (made controllable per
// test below) so it can be held pending during the abort window; every other
// export (reconstructTurns, selectHistoryTurns, dedupeRecognizedHits, etc.)
// stays real, since useAsk.ts's flow depends on their actual behavior.
vi.mock('@/features/ask/askHelpers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/ask/askHelpers')>();
  return {
    ...actual,
    buildResolvedAskProvider: (...args: []) => h.buildResolvedAskProvider(...args),
  };
});

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

// QA-25 (P1, Codex re-review) — `assertLocalOnlyAllowsSend` is the first
// synchronous call after `buildResolvedAskProvider()` resolves. It's the most
// direct, reliable signal for "did handleAsk keep going past a resolution
// that finished AFTER the request was cancelled" — the full send pipeline
// below it depends on many other real modules that are awkward to fully
// simulate in a unit test.
vi.mock('@/platform/privacy/localOnlyGuard', () => ({
  isLocalOnlyMode: () => false,
  assertLocalOnlyAllowsSend: (...args: [string]) => h.assertLocalOnlyAllowsSend(...args),
  assertLocalOnlyAllowsExternal: () => undefined,
  isConfidentialityChoiceRequiredError: () => false,
  assertCloudGenerationAllowed: () => undefined,
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
    h.buildResolvedAskProvider.mockReset();
    h.assertLocalOnlyAllowsSend.mockReset();
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
      expect.objectContaining({ role: 'assistant', content: ASK_CANCELLED_BY_NAVIGATION_MESSAGE }),
    );
  });

  it('clicking "New question" mid-flight (same client, different thread) also leaves an honest record, worded neutrally rather than blaming a client switch', () => {
    // Codex review: the chatId-switch cleanup fires for ANY chatId change,
    // including staying on the SAME client but starting a fresh thread — the
    // persisted copy must not claim "you switched to a different client"
    // for this case, since that would be false.
    render(<Ask />);

    const input = screen.getByTestId('ask-composer-input') as HTMLInputElement;
    act(() => {
      fireEvent.change(input, { target: { value: 'Is the Roth conversion done for this year?' } });
    });
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: /^Ask$/i }));
    });
    expect(h.addMessage).not.toHaveBeenCalled();

    act(() => {
      fireEvent.click(screen.getByTestId('rail-new-question'));
    });

    const emilyChatId = 'ask-matter_emily::/ws';
    expect(h.addMessage).toHaveBeenCalledWith(
      emilyChatId,
      expect.objectContaining({ role: 'assistant', content: ASK_CANCELLED_BY_NAVIGATION_MESSAGE }),
    );
  });

  it('P1 (Codex re-review) — navigating away DURING provider resolution aborts cleanly: no send, no persisted answer, cancelled record only', async () => {
    // Retrieval resolves fast with no hits (smart mode proceeds to Step 2
    // regardless — see the emitNoEvidenceDecline gate, which only dead-ends
    // in files-only mode).
    h.retrieve.mockResolvedValueOnce([]);

    // Hold provider resolution pending until the test explicitly resolves it
    // — this is the exact await (useAsk.ts's `await buildResolvedAskProvider()`)
    // that had no post-await abort check before the fix.
    let resolveProvider!: (v: unknown) => void;
    h.buildResolvedAskProvider.mockReturnValueOnce(
      new Promise((resolve) => { resolveProvider = resolve; }),
    );

    const { rerender } = render(<Ask />);

    const input = screen.getByTestId('ask-composer-input') as HTMLInputElement;
    act(() => {
      fireEvent.change(input, { target: { value: 'Is the Roth conversion done for this year?' } });
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^Ask$/i }));
      // Let retrieval's microtask settle so execution actually reaches the
      // pending buildResolvedAskProvider() await before we navigate away.
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(h.buildResolvedAskProvider).toHaveBeenCalledTimes(1);
    expect(h.addMessage).not.toHaveBeenCalled();

    // Navigate away WHILE provider resolution is still pending.
    h.activeMatter = GARCIA;
    act(() => {
      rerender(<Ask />);
    });

    const emilyChatId = 'ask-matter_emily::/ws';
    expect(h.addMessage).toHaveBeenCalledWith(
      emilyChatId,
      expect.objectContaining({ role: 'assistant', content: ASK_CANCELLED_BY_NAVIGATION_MESSAGE }),
    );
    const cancelledCallCount = h.addMessage.mock.calls.length;

    // NOW let the stale resolution settle — a local provider, so it would
    // sail past the local-only re-check and straight to flushSync/send if
    // the post-await abort guard were missing.
    await act(async () => {
      resolveProvider({
        provider: { getMetadata: () => ({ provider: 'lantern-local', model: 'stub' }) },
        providerId: 'lantern-local',
        model: 'stub',
      });
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    // handleAsk must not proceed AT ALL once the resolution it awaited turns
    // out to belong to a cancelled request — not the local-only guard right
    // after it, not the actual provider send, and no additional (e.g.
    // "successful answer") message landing on top of the cancelled record.
    expect(h.assertLocalOnlyAllowsSend).not.toHaveBeenCalled();
    expect(h.sendMessage).not.toHaveBeenCalled();
    expect(h.addMessage).toHaveBeenCalledTimes(cancelledCallCount);
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
