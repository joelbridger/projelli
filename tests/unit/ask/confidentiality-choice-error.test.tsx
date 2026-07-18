/**
 * BUG1 — Ask must not blame file search when provider setup is blocked by the
 * personal-install confidentiality-choice gate.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

const h = vi.hoisted(() => ({
  retrieve: vi.fn(),
  buildResolvedAskProvider: vi.fn(),
  initSession: vi.fn(),
  setSessionWorkspaceRoot: vi.fn(),
  addMessage: vi.fn(),
  sessions: {} as Record<string, { messages: unknown[]; lastUpdated: string }>,
}));

vi.mock('@/platform/rag/MemoryService', async (orig) => {
  const real = await orig<typeof import('@/platform/rag/MemoryService')>();
  return {
    ...real,
    MemoryService: {
      ...real.MemoryService,
      retrieve: h.retrieve,
    },
    isMemoryEnabled: () => true,
  };
});

vi.mock('@/features/ask/askHelpers', async (orig) => {
  const real = await orig<typeof import('@/features/ask/askHelpers')>();
  return {
    ...real,
    buildResolvedAskProvider: h.buildResolvedAskProvider,
  };
});

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
    selector({ profession: 'advisor' }),
}));

vi.mock('@/platform/matter/samples/sampleMatterDemo', () => ({
  getDemoAnswerForWorkspace: vi.fn().mockReturnValue(null),
  getDemoQuestions: vi.fn().mockReturnValue([]),
}));

vi.mock('@/platform/rag/matterResolver', () => ({
  matterLabel: () => 'Client',
}));

vi.mock('@/platform/hooks/useConfidentialityMode', () => ({
  getConfidentialityMode: () => 'direct',
  useConfidentialityMode: () => 'direct',
}));

vi.mock('@/platform/state/aiChatStore', () => {
  const hook = (selector: (s: unknown) => unknown) =>
    selector({
      initSession: h.initSession,
      setSessionWorkspaceRoot: h.setSessionWorkspaceRoot,
      addMessage: h.addMessage,
      sessions: h.sessions,
    });
  hook.getState = () => ({
    initSession: h.initSession,
    setSessionWorkspaceRoot: h.setSessionWorkspaceRoot,
    addMessage: h.addMessage,
    sessions: h.sessions,
  });
  return {
    useAIChatStore: hook,
    // F2.5 — Ask reads per-conversation file-access consent; granted (all-clients)
    // here so these tests still exercise the consented retrieval path.
    useFileAccessConsent: () => ({ state: "granted", grantedScope: { kind: "allMatters" } }),
    getFileAccessConsent: () => ({ state: "granted", grantedScope: { kind: "allMatters" } }),
  };
});

import { useAsk } from '@/features/ask/useAsk';
import { ConfidentialityChoiceRequiredError } from '@/platform/privacy/localOnlyGuard';

describe('Ask confidentiality-choice error handling', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    h.sessions = {};
    h.retrieve.mockResolvedValue([
      { path: '/client.md', chunkText: 'Client has a Roth conversion window.', score: 0.9, paragraphIndex: 0 },
    ]);
    const choiceError = new ConfidentialityChoiceRequiredError();
    choiceError.message = 'Open Settings > Privacy and choose how cloud AI requests should work.';
    h.buildResolvedAskProvider.mockRejectedValue(choiceError);
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('surfaces the confidentiality action by error type, not English message text, and logs the raw error', async () => {
    const { result } = renderHook(() => useAsk({}));

    act(() => {
      result.current.setQuestion('What should I know before the review?');
    });
    await act(async () => {
      await result.current.handleAsk();
    });

    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.errorMsg).toMatch(/Settings.*Privacy|Privacy.*choose/i);
    expect(result.current.errorMsg).not.toMatch(/Before sending to a cloud AI/i);
    expect(result.current.errorMsg).not.toMatch(/couldn't search your files/i);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringMatching(/Ask failed/i),
      expect.any(ConfidentialityChoiceRequiredError),
    );
  });
});
