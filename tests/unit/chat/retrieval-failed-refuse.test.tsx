/**
 * F-116 — "Avianca trap" guard.
 *
 * When "Ask my workspace" is ON and workspace retrieval FAILS (throws), the
 * chat must NOT proceed to call the AI provider and return a confident-looking
 * grounded answer. Instead it must post a clear refusal assistant message and
 * stop without calling sendMessage.
 *
 * This applies whether the failure is "RAG is only available in the desktop
 * app" (browser build) or any other retrieval error.
 *
 * Assertions:
 *   1. sendMessage is NOT called when retrieval throws.
 *   2. An assistant refusal message IS added to the chat.
 *   3. The refusal message does NOT contain fabricated citations (no
 *      [filename paragraph N] patterns from the model).
 *   4. The user message is still added (user turn is never lost).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  retrieve: vi.fn(),
  sendMessage: vi.fn(),
}));

vi.mock('@/platform/rag/MemoryService', async (orig) => {
  const real = await orig<typeof import('@/platform/rag/MemoryService')>();
  return {
    ...real,
    MemoryService: {
      ...real.MemoryService,
      retrieve: mocks.retrieve,
    },
    isMemoryEnabled: () => true,
  };
});

vi.mock('@/platform/providers/ClaudeProvider', () => ({
  ClaudeProvider: class {
    setTools() {}
    sendMessage = mocks.sendMessage;
    sendMessageStreaming = undefined;
    getMetadata() { return { model: 'stub' }; }
  },
}));
vi.mock('@/platform/providers/OpenAIProvider', () => ({
  OpenAIProvider: class {
    setTools() {}
    sendMessage = mocks.sendMessage;
    sendMessageStreaming = undefined;
    getMetadata() { return { model: 'stub' }; }
  },
}));
vi.mock('@/platform/providers/GeminiProvider', () => ({
  GeminiProvider: class {
    setTools() {}
    sendMessage = mocks.sendMessage;
    sendMessageStreaming = undefined;
    getMetadata() { return { model: 'stub' }; }
  },
}));
vi.mock('@/features/ask/ChatCostChip', () => ({
  ChatCostChip: () => null,
}));

import { AIChatViewer } from '@/features/ask/AIChatViewer';
import type { AIChatFile } from '@/platform/types/ai';
import { useAIChatStore } from '@/platform/state/aiChatStore';

const chat: AIChatFile = {
  id: 'f116-test',
  title: 'F-116 Refuse Test',
  created: new Date().toISOString(),
  updated: new Date().toISOString(),
  messages: [],
  provider: 'anthropic',
  model: 'stub',
};

const apiKey = [{ provider: 'anthropic', key: 'stub-key', isValid: true }];

describe('F-116 — Ask-workspace ON + retrieval fails → refuse without calling model', () => {
  beforeEach(() => {
    mocks.retrieve.mockReset();
    mocks.sendMessage.mockReset();
    useAIChatStore.setState({ sessions: {}, dailyCosts: {}, askWorkspaceMode: {} });

    // Retrieval throws the browser-mode error.
    mocks.retrieve.mockRejectedValue(
      new Error('RAG is only available in the desktop app.')
    );
    // sendMessage should never be called, but configure a return just in case.
    mocks.sendMessage.mockResolvedValue({
      content: 'Based on my analysis of the transcript [deposition.pdf paragraph 31]...',
      usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
      cost: 0.001,
      model: 'stub',
    });
  });

  afterEach(() => {
    useAIChatStore.setState({ sessions: {}, dailyCosts: {}, askWorkspaceMode: {} });
  });

  it('does NOT call sendMessage when retrieval throws and Ask-workspace is ON', async () => {
    render(<AIChatViewer chatData={chat} apiKeys={apiKey} />);

    // Turn on Ask my workspace
    act(() => {
      fireEvent.click(screen.getByTestId('ask-workspace-toggle'));
    });

    const textarea = screen.getByTestId('chat-input') as HTMLTextAreaElement;
    act(() => {
      fireEvent.change(textarea, { target: { value: 'What did the witness say on page 31?' } });
    });
    act(() => {
      fireEvent.click(screen.getByTestId('chat-send-button'));
    });

    // Wait a tick for async processing
    await waitFor(() => {
      // There should be at least one assistant message (the refusal)
      const msgs = useAIChatStore.getState().sessions[chat.id]?.messages ?? [];
      const assistantMsgs = msgs.filter((m) => m.role === 'assistant');
      expect(assistantMsgs.length).toBeGreaterThan(0);
    });

    // The provider should NEVER have been called
    expect(mocks.sendMessage).not.toHaveBeenCalled();
  });

  it('adds a refusal assistant message that does NOT contain fabricated citations', async () => {
    render(<AIChatViewer chatData={chat} apiKeys={apiKey} />);

    act(() => {
      fireEvent.click(screen.getByTestId('ask-workspace-toggle'));
    });

    const textarea = screen.getByTestId('chat-input') as HTMLTextAreaElement;
    act(() => {
      fireEvent.change(textarea, { target: { value: 'What did the witness say on page 31?' } });
    });
    act(() => {
      fireEvent.click(screen.getByTestId('chat-send-button'));
    });

    await waitFor(() => {
      const msgs = useAIChatStore.getState().sessions[chat.id]?.messages ?? [];
      const assistantMsgs = msgs.filter((m) => m.role === 'assistant');
      expect(assistantMsgs.length).toBeGreaterThan(0);
    });

    const msgs = useAIChatStore.getState().sessions[chat.id]?.messages ?? [];
    const lastAssistant = [...msgs].reverse().find((m) => m.role === 'assistant');
    expect(lastAssistant).toBeDefined();

    // The refusal must NOT contain any [filename paragraph N] citation markers
    // (that would imply the model fabricated grounded-looking content).
    const fabricatedCitePattern = /\[[^\]]+\s+(?:paragraph\s+|§\s*)\d+\]/i;
    expect(lastAssistant!.content).not.toMatch(fabricatedCitePattern);

    // The refusal should indicate it couldn't search the workspace.
    expect(lastAssistant!.content.toLowerCase()).toMatch(
      /couldn.t search|workspace|retriev/i
    );
  });

  it('still adds the user message to the chat (user turn is preserved)', async () => {
    render(<AIChatViewer chatData={chat} apiKeys={apiKey} />);

    act(() => {
      fireEvent.click(screen.getByTestId('ask-workspace-toggle'));
    });

    const textarea = screen.getByTestId('chat-input') as HTMLTextAreaElement;
    act(() => {
      fireEvent.change(textarea, { target: { value: 'What did the witness say on page 31?' } });
    });
    act(() => {
      fireEvent.click(screen.getByTestId('chat-send-button'));
    });

    await waitFor(() => {
      const msgs = useAIChatStore.getState().sessions[chat.id]?.messages ?? [];
      const userMsgs = msgs.filter((m) => m.role === 'user');
      expect(userMsgs.length).toBeGreaterThan(0);
    });

    const msgs = useAIChatStore.getState().sessions[chat.id]?.messages ?? [];
    const userMsg = msgs.find((m) => m.role === 'user');
    expect(userMsg?.content).toBe('What did the witness say on page 31?');
  });

  it('DOES call sendMessage normally when retrieval succeeds with results (control case)', async () => {
    // Override: retrieval succeeds with at least one result.
    mocks.retrieve.mockResolvedValue([
      {
        path: 'deposition.pdf',
        chunkText: 'The witness stated on page 31...',
        score: 0.92,
        paragraphIndex: 31,
      },
    ]);

    render(<AIChatViewer chatData={chat} apiKeys={apiKey} />);

    act(() => {
      fireEvent.click(screen.getByTestId('ask-workspace-toggle'));
    });

    const textarea = screen.getByTestId('chat-input') as HTMLTextAreaElement;
    act(() => {
      fireEvent.change(textarea, { target: { value: 'What did the witness say?' } });
    });
    act(() => {
      fireEvent.click(screen.getByTestId('chat-send-button'));
    });

    // When retrieval succeeds with results, sendMessage SHOULD be called.
    await waitFor(() => {
      expect(mocks.sendMessage).toHaveBeenCalledTimes(1);
    });
  });
});

describe('F-116 — Ask-workspace ON + retrieval returns ZERO results → refuse without calling model', () => {
  beforeEach(() => {
    mocks.retrieve.mockReset();
    mocks.sendMessage.mockReset();
    useAIChatStore.setState({ sessions: {}, dailyCosts: {}, askWorkspaceMode: {} });

    // Retrieval SUCCEEDS but returns an empty array — the "found nothing" case.
    mocks.retrieve.mockResolvedValue([]);
    mocks.sendMessage.mockResolvedValue({
      content: 'Based on my analysis of the transcript [deposition.pdf paragraph 31]...',
      usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
      cost: 0.001,
      model: 'stub',
    });
  });

  afterEach(() => {
    useAIChatStore.setState({ sessions: {}, dailyCosts: {}, askWorkspaceMode: {} });
  });

  it('does NOT call sendMessage when retrieval returns zero results and Ask-workspace is ON', async () => {
    render(<AIChatViewer chatData={chat} apiKeys={apiKey} />);

    act(() => {
      fireEvent.click(screen.getByTestId('ask-workspace-toggle'));
    });

    const textarea = screen.getByTestId('chat-input') as HTMLTextAreaElement;
    act(() => {
      fireEvent.change(textarea, { target: { value: 'What about the Avianca contract?' } });
    });
    act(() => {
      fireEvent.click(screen.getByTestId('chat-send-button'));
    });

    await waitFor(() => {
      const msgs = useAIChatStore.getState().sessions[chat.id]?.messages ?? [];
      const assistantMsgs = msgs.filter((m) => m.role === 'assistant');
      expect(assistantMsgs.length).toBeGreaterThan(0);
    });

    // The AI provider must NOT have been called.
    expect(mocks.sendMessage).not.toHaveBeenCalled();
  });

  it('posts a distinct refusal message that references "workspace" and "found nothing"', async () => {
    render(<AIChatViewer chatData={chat} apiKeys={apiKey} />);

    act(() => {
      fireEvent.click(screen.getByTestId('ask-workspace-toggle'));
    });

    const textarea = screen.getByTestId('chat-input') as HTMLTextAreaElement;
    act(() => {
      fireEvent.change(textarea, { target: { value: 'What about the Avianca contract?' } });
    });
    act(() => {
      fireEvent.click(screen.getByTestId('chat-send-button'));
    });

    await waitFor(() => {
      const msgs = useAIChatStore.getState().sessions[chat.id]?.messages ?? [];
      const assistantMsgs = msgs.filter((m) => m.role === 'assistant');
      expect(assistantMsgs.length).toBeGreaterThan(0);
    });

    const msgs = useAIChatStore.getState().sessions[chat.id]?.messages ?? [];
    const lastAssistant = [...msgs].reverse().find((m) => m.role === 'assistant');
    expect(lastAssistant).toBeDefined();

    // The refusal must not contain fabricated citations.
    const fabricatedCitePattern = /\[[^\]]+\s+(?:paragraph\s+|§\s*)\d+\]/i;
    expect(lastAssistant!.content).not.toMatch(fabricatedCitePattern);

    // The message should indicate a workspace search that found nothing relevant.
    expect(lastAssistant!.content.toLowerCase()).toMatch(
      /workspace|found nothing|nothing relevant|no.*(result|source)/i
    );
  });

  it('does NOT refuse when Ask-workspace is OFF and retrieval returns empty (normal chat unaffected)', async () => {
    // This test verifies the guard does NOT fire for normal chat.
    // Ask-workspace is OFF; retrieval should not even run.
    render(<AIChatViewer chatData={chat} apiKeys={apiKey} />);

    // Do NOT click the ask-workspace-toggle — leave it OFF.

    const textarea = screen.getByTestId('chat-input') as HTMLTextAreaElement;
    act(() => {
      fireEvent.change(textarea, { target: { value: 'General question, no workspace needed.' } });
    });
    act(() => {
      fireEvent.click(screen.getByTestId('chat-send-button'));
    });

    // sendMessage SHOULD be called because Ask-workspace is OFF.
    await waitFor(() => {
      expect(mocks.sendMessage).toHaveBeenCalledTimes(1);
    });
  });
});
