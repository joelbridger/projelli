/**
 * Perf (P1.2) fix — auto-scroll must follow a streaming answer, not just
 * jump once at the end.
 *
 * The scroll-to-bottom effect used to depend on `messages` (the committed
 * store array). Since chunks now accumulate in a local `streamingPreview`
 * overlay and `messages` itself doesn't change until the turn's single
 * final store write, depending on `messages` alone meant the chat pane
 * stopped following a long streaming answer until it finished. The effect
 * now depends on `displayMessages` (the actually-rendered array, preview
 * included).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  sendMessage: vi.fn(),
  sendMessageStreaming: vi.fn(),
}));

vi.mock('@/platform/providers/ClaudeProvider', () => ({
  ClaudeProvider: class {
    setTools() {}
    sendMessage = mocks.sendMessage;
    sendMessageStreaming = mocks.sendMessageStreaming;
    getMetadata() { return { model: 'stub', providerId: 'anthropic' }; }
  },
}));
vi.mock('@/platform/providers/OpenAIProvider', () => ({
  OpenAIProvider: class {
    setTools() {}
    sendMessage = mocks.sendMessage;
    sendMessageStreaming = mocks.sendMessageStreaming;
    getMetadata() { return { model: 'stub' }; }
  },
  OPENAI_DEFAULT_MODEL: 'gpt-4o',
}));
vi.mock('@/platform/providers/GeminiProvider', () => ({
  GeminiProvider: class {
    setTools() {}
    sendMessage = mocks.sendMessage;
    sendMessageStreaming = mocks.sendMessageStreaming;
    getMetadata() { return { model: 'stub' }; }
  },
}));

vi.mock('@/features/ask/ChatCostChip', () => ({ ChatCostChip: () => null }));

vi.mock('@/platform/privacy/localOnlyGuard', async (orig) => {
  const real = await orig<typeof import('@/platform/privacy/localOnlyGuard')>();
  return {
    ...real,
    assertCloudGenerationAllowed: vi.fn(),
    assertLocalOnlyAllowsSend: vi.fn(),
    isLocalOnlyMode: () => false,
  };
});

import { AIChatViewer, type APIKey } from '@/features/ask/AIChatViewer';
import { useAIChatStore } from '@/platform/state/aiChatStore';
import type { AIChatFile } from '@/platform/types/ai';

const apiKeys: APIKey[] = [{ provider: 'anthropic', key: 'stub-key', isValid: true }];
const CHUNK_COUNT = 30;
const CHUNK_DELAY_MS = 15;

function makeChat(): AIChatFile {
  return {
    id: 'stream-autoscroll',
    title: 'Stream autoscroll',
    created: '2026-07-01T00:00:00.000Z',
    updated: '2026-07-01T00:00:00.000Z',
    messages: [],
    provider: 'anthropic',
    model: 'stub-model',
  };
}

describe('Perf (P1.2) fix — auto-scroll follows a streaming answer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAIChatStore.setState({ sessions: {}, dailyCosts: {}, askWorkspaceMode: {} });
  });

  afterEach(() => {
    useAIChatStore.setState({ sessions: {}, dailyCosts: {}, askWorkspaceMode: {} });
  });

  it('calls scrollIntoView more than once while chunks are still arriving', async () => {
    mocks.sendMessage.mockResolvedValue({
      content: 'unused',
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      cost: 0,
      model: 'stub-model',
    });
    mocks.sendMessageStreaming.mockImplementation(
      async (_prompt: string, opts: { onChunk: (chunk: string) => void }) => {
        let content = '';
        for (let i = 0; i < CHUNK_COUNT; i++) {
          const chunk = `w${i} `;
          content += chunk;
          opts.onChunk(chunk);
          // eslint-disable-next-line no-await-in-loop
          await new Promise((resolve) => setTimeout(resolve, CHUNK_DELAY_MS));
        }
        return {
          content,
          usage: { inputTokens: 5, outputTokens: CHUNK_COUNT, totalTokens: CHUNK_COUNT + 5 },
          cost: 0,
          model: 'stub-model',
        };
      },
    );

    const scrollSpy = vi.spyOn(Element.prototype, 'scrollIntoView');

    render(<AIChatViewer chatData={makeChat()} apiKeys={apiKeys} />);
    act(() => fireEvent.change(screen.getByTestId('chat-input'), { target: { value: 'stream a long answer' } }));
    act(() => fireEvent.click(screen.getByTestId('chat-send-button')));

    await waitFor(() => expect(mocks.sendMessageStreaming).toHaveBeenCalledTimes(1));

    // Let the send-time scrolls (mount, user message added, empty assistant
    // placeholder added) settle before taking the baseline — none of these
    // are chunk-driven, so they must not count toward "scrolled while
    // streaming".
    await new Promise((resolve) => setTimeout(resolve, CHUNK_DELAY_MS));
    const baselineCalls = scrollSpy.mock.calls.length;

    // Wait through roughly the middle of the stream — several more chunks'
    // worth of time, well before it completes.
    await new Promise((resolve) => setTimeout(resolve, CHUNK_COUNT * CHUNK_DELAY_MS * 0.6));

    const midStreamCalls = scrollSpy.mock.calls.length;
    // Still streaming — the loading indicator should still be visible.
    expect(screen.queryByTestId('chat-loading-indicator')).not.toBeNull();
    // The pane must have kept following the growing preview as chunks
    // arrived, not just scrolled once at send time and then frozen.
    expect(midStreamCalls).toBeGreaterThan(baselineCalls);

    await waitFor(() => expect(screen.queryByTestId('chat-loading-indicator')).toBeNull(), { timeout: 5000 });
    scrollSpy.mockRestore();
  });
});
