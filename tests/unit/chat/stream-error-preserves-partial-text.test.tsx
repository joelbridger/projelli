/**
 * Perf (P1.2) fix — a stream that errors mid-response must not lose the
 * partial text the user already saw.
 *
 * Chunks now accumulate in a local buffer (see stream-buffering.test.tsx)
 * instead of writing to the store per-token, and the store's placeholder
 * assistant message is normally only committed once the citation-
 * verification step finishes successfully. If the provider throws (e.g. a
 * network reset) AFTER emitting some chunks, that success path never runs —
 * so without this fix the placeholder would stay permanently empty and the
 * partial answer the user watched stream in would just vanish, replaced by
 * an empty bubble followed by the error message.
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

function makeChat(): AIChatFile {
  return {
    id: 'stream-error-partial-text',
    title: 'Stream error partial text',
    created: '2026-07-01T00:00:00.000Z',
    updated: '2026-07-01T00:00:00.000Z',
    messages: [],
    provider: 'anthropic',
    model: 'stub-model',
  };
}

describe('Perf (P1.2) fix — stream error preserves partial text', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAIChatStore.setState({ sessions: {}, dailyCosts: {}, askWorkspaceMode: {} });
  });

  afterEach(() => {
    useAIChatStore.setState({ sessions: {}, dailyCosts: {}, askWorkspaceMode: {} });
  });

  it('keeps the streamed-so-far text visible when the provider throws mid-stream', async () => {
    mocks.sendMessage.mockResolvedValue({
      content: 'unused',
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      cost: 0,
      model: 'stub-model',
    });
    mocks.sendMessageStreaming.mockImplementation(
      async (_prompt: string, opts: { onChunk: (chunk: string) => void }) => {
        opts.onChunk('The market moved ');
        opts.onChunk('sharply today because');
        throw new Error('network reset mid-stream');
      },
    );

    render(<AIChatViewer chatData={makeChat()} apiKeys={apiKeys} />);
    act(() => fireEvent.change(screen.getByTestId('chat-input'), { target: { value: 'what happened today' } }));
    act(() => fireEvent.click(screen.getByTestId('chat-send-button')));

    await waitFor(() => expect(mocks.sendMessageStreaming).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByTestId('chat-loading-indicator')).toBeNull());

    // The partial text the user watched stream in must still be there...
    expect(screen.getByText(/The market moved sharply today because/)).toBeTruthy();
    // ...as its own bubble (not merged into the error bubble), followed by
    // a separate error message — matching pre-buffering behavior.
    const bubbles = screen.getAllByTestId(/^chat-message-\d+$/);
    expect(bubbles.length).toBeGreaterThanOrEqual(2);
    const errorBubble = bubbles.find((b) => b.textContent?.includes('network reset mid-stream'));
    expect(errorBubble).toBeTruthy();
  });
});
