/**
 * Perf (P1.2) — measurement harness for token-stream buffering.
 *
 * Drives a real AIChatViewer through a simulated 500-chunk stream (a small
 * delay between chunks so real animation frames actually elapse, the way a
 * live SSE response would) and counts two things:
 *
 *  1. How many times the Zustand aiChatStore actually broadcasts a state
 *     change (`useAIChatStore.subscribe`) while the stream is in flight.
 *  2. How many times the AIChatViewer subtree commits (`React.Profiler`).
 *
 * Before this change, every chunk called `updateLastMessage` directly, so
 * both numbers scaled ~1:1 with chunk count (500 chunks → ~500 store
 * broadcasts → ~500 commits). After the change, chunks accumulate locally
 * and only flush at most once per animation frame, so both numbers should
 * scale with elapsed TIME (frame count), not chunk count, plus exactly one
 * final store commit for the turn.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Profiler, type ProfilerOnRenderCallback } from 'react';

const CHUNK_COUNT = 500;
// A few ms between chunks — enough that real animation frames elapse across
// the whole stream (jsdom's rAF ticks on a macrotask), without making the
// test itself slow.
const CHUNK_DELAY_MS = 2;

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

function makeChat(): AIChatFile {
  return {
    id: 'stream-buffering-perf',
    title: 'Stream buffering perf',
    created: '2026-07-01T00:00:00.000Z',
    updated: '2026-07-01T00:00:00.000Z',
    messages: [],
    provider: 'anthropic',
    model: 'stub-model',
  };
}

describe('Perf (P1.2) — token-stream buffering', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAIChatStore.setState({ sessions: {}, dailyCosts: {}, askWorkspaceMode: {} });
  });

  afterEach(() => {
    useAIChatStore.setState({ sessions: {}, dailyCosts: {}, askWorkspaceMode: {} });
  });

  it(`buffers a ${CHUNK_COUNT}-chunk stream into a small, bounded number of store writes + renders`, async () => {
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
          const chunk = `t${i} `;
          content += chunk;
          opts.onChunk(chunk);
          await new Promise((resolve) => setTimeout(resolve, CHUNK_DELAY_MS));
        }
        return {
          content,
          usage: { inputTokens: 10, outputTokens: CHUNK_COUNT, totalTokens: CHUNK_COUNT + 10 },
          cost: 0,
          model: 'stub-model',
        };
      },
    );

    let storeBroadcasts = 0;
    const unsubscribe = useAIChatStore.subscribe(() => {
      storeBroadcasts++;
    });

    let commitCount = 0;
    const onRender: ProfilerOnRenderCallback = () => {
      commitCount++;
    };

    render(
      <Profiler id="ai-chat-viewer-perf" onRender={onRender}>
        <AIChatViewer chatData={makeChat()} apiKeys={apiKeys} />
      </Profiler>,
    );
    // Rendering the initial tree already commits once (or more, from effects);
    // only count what happens from the send onward.
    commitCount = 0;
    storeBroadcasts = 0;

    act(() => fireEvent.change(screen.getByTestId('chat-input'), { target: { value: 'stream 500 chunks' } }));
    act(() => fireEvent.click(screen.getByTestId('chat-send-button')));

    await waitFor(() => expect(mocks.sendMessageStreaming).toHaveBeenCalledTimes(1), { timeout: 10_000 });
    await waitFor(
      () => expect(screen.queryByTestId('chat-loading-indicator')).toBeNull(),
      { timeout: 10_000 },
    );

    unsubscribe();

    // The final answer landed (proves buffering didn't drop content).
    const finalText = `t${CHUNK_COUNT - 1} `;
    expect(screen.getByTestId('chat-messages').textContent).toContain(finalText.trim());

    console.log(
      `[perf/stream-buffering] chunks=${CHUNK_COUNT} storeBroadcasts=${storeBroadcasts} viewerCommits=${commitCount}`,
    );

    // Before this change, each of the 500 onChunk calls wrote straight to
    // the store (updateLastMessage) — one broadcast per chunk, ~500+ total.
    // After: at most one flush per animation frame while streaming, plus
    // exactly one final commit — bounded well under the chunk count.
    expect(storeBroadcasts).toBeLessThan(CHUNK_COUNT / 2);
    expect(commitCount).toBeLessThan(CHUNK_COUNT / 2);
  }, 20_000);
});
