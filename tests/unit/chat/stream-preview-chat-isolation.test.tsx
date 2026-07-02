/**
 * Perf (P1.2) fix — a P1 confidentiality bug caught in Codex review round 3.
 *
 * MainPanel reuses the SAME AIChatViewer instance across different open
 * chats (no per-chat `key`), so the local `streamingPreview` state this
 * feature introduced survives a `chatId` prop change. Before this fix, a
 * stream started in one chat whose `onChunk` callbacks were still firing
 * after the user switched to a DIFFERENT chat would patch the newly-viewed
 * chat's last message with the OLD chat's streamed text — briefly showing
 * one client's in-progress answer inside another client's chat. For a
 * product whose entire pitch is per-client data isolation, that is a
 * critical bug, not a cosmetic one.
 *
 * Fix: the preview is tagged with the chatId the stream actually belongs
 * to, and only applied when it matches the chat currently being viewed.
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

const CHAT_A: AIChatFile = {
  id: 'chat-a-confidential-acme',
  title: 'Acme Corp',
  created: '2026-07-01T00:00:00.000Z',
  updated: '2026-07-01T00:00:00.000Z',
  messages: [],
  provider: 'anthropic',
  model: 'stub-model',
};

const CHAT_B: AIChatFile = {
  id: 'chat-b-confidential-beta',
  title: 'Beta LLC',
  created: '2026-07-01T00:00:00.000Z',
  updated: '2026-07-01T00:00:00.000Z',
  messages: [
    { role: 'user', content: 'What is Beta LLC\'s allocation?', timestamp: '2026-07-01T00:00:00.000Z' },
    { role: 'assistant', content: 'Beta LLC is allocated 60% equities.', timestamp: '2026-07-01T00:00:01.000Z' },
  ],
  provider: 'anthropic',
  model: 'stub-model',
};

const ACME_SECRET = 'Acme is being investigated for fraud';

describe('Perf (P1.2) fix — streaming preview never leaks across chats', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAIChatStore.setState({ sessions: {}, dailyCosts: {}, askWorkspaceMode: {} });
  });

  afterEach(() => {
    useAIChatStore.setState({ sessions: {}, dailyCosts: {}, askWorkspaceMode: {} });
  });

  it('does not show chat A\'s in-flight streamed text after switching to chat B', async () => {
    mocks.sendMessage.mockResolvedValue({
      content: 'unused',
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      cost: 0,
      model: 'stub-model',
    });

    let deliverNextChunk: (() => void) | null = null;
    mocks.sendMessageStreaming.mockImplementation(
      (_prompt: string, opts: { onChunk: (c: string) => void }) =>
        new Promise((resolve) => {
          // Deliver chunks on demand (driven by the test) instead of a fixed
          // timer, so we can deterministically pause mid-stream, switch
          // chats, THEN keep delivering — proving a still-running stream's
          // callbacks can't leak into the newly-viewed chat.
          let content = '';
          const chunks = [ACME_SECRET.slice(0, 10), ACME_SECRET.slice(10, 20), ACME_SECRET.slice(20)];
          let i = 0;
          const deliverOne = () => {
            if (i >= chunks.length) {
              resolve({
                content,
                usage: { inputTokens: 5, outputTokens: 5, totalTokens: 10 },
                cost: 0,
                model: 'stub-model',
              });
              return;
            }
            content += chunks[i];
            opts.onChunk(chunks[i]!);
            i++;
          };
          deliverNextChunk = deliverOne;
          deliverOne();
        }),
    );

    const { rerender } = render(<AIChatViewer chatData={CHAT_A} apiKeys={apiKeys} />);
    act(() => fireEvent.change(screen.getByTestId('chat-input'), { target: { value: 'tell me about Acme' } }));
    act(() => fireEvent.click(screen.getByTestId('chat-send-button')));

    await waitFor(() => expect(mocks.sendMessageStreaming).toHaveBeenCalledTimes(1));

    // Let chat A's first chunk's rAF flush land, so the local preview is
    // actually showing chat A's partial confidential text right now.
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(resolve));
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(screen.getByTestId('chat-messages').textContent).toContain(ACME_SECRET.slice(0, 10));

    // The user switches tabs to a DIFFERENT client's chat — MainPanel
    // re-renders the SAME AIChatViewer instance with chat B's data. Chat A's
    // stream is still in flight (has NOT resolved/errored/aborted).
    rerender(<AIChatViewer chatData={CHAT_B} apiKeys={apiKeys} />);

    // Chat A's stream keeps delivering chunks after the switch.
    await act(async () => {
      deliverNextChunk?.();
      await new Promise((resolve) => requestAnimationFrame(resolve));
      deliverNextChunk?.();
      await new Promise((resolve) => setTimeout(resolve, 30));
    });

    // Chat B's real content must be showing...
    expect(screen.getByText("Beta LLC is allocated 60% equities.")).toBeTruthy();
    // ...and chat A's confidential partial text must NEVER appear here.
    expect(screen.queryByText(new RegExp(ACME_SECRET.slice(0, 10)))).toBeNull();
    expect(screen.getByTestId('chat-messages').textContent).not.toContain(ACME_SECRET.slice(0, 10));
  });
});
