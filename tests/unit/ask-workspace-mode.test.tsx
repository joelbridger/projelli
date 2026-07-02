/**
 * Ask-my-workspace chat mode — verifies the M2 toggle wiring end-to-end
 * from the header button through retrieval to prompt injection.
 *
 * Because `AIChatViewer` composes three providers + streaming + tools,
 * we mock:
 *   - `MemoryService.retrieve` so no real RAG backend is needed.
 *   - The three provider classes so network calls never fire.
 *   - `ChatCostChip` (it uses Radix Tooltip which needs TooltipProvider
 *     at the test root; the chip itself isn't what we're testing).
 *
 * Assertions:
 *   1. Toggle is OFF by default; ON after clicking.
 *   2. When ON, sending a message calls `MemoryService.retrieve` BEFORE
 *      calling the provider's `sendMessage`.
 *   3. The provider receives a systemPrompt containing the
 *      `<workspace_context>` block populated from the retrieval hits.
 *   4. The assistant message ends up carrying the retrieval sources
 *      so the accordion has something to render.
 *   5. `@workspace` still fires retrieval even with the toggle off.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';

// `vi.hoisted` moves these alongside the mock factory. Without it the
// mock factory (also hoisted) would reference an uninitialised binding.
const mocks = vi.hoisted(() => ({
  retrieve: vi.fn(),
  sendMessage: vi.fn(),
}));

vi.mock('@/platform/rag/MemoryService', async (orig) => {
  const real = await orig<
    typeof import('@/platform/rag/MemoryService')
  >();
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

// ChatCostChip uses Radix Tooltip, which requires a TooltipProvider at
// the root. Not relevant to M2 — stub it out.
vi.mock('@/features/ask/ChatCostChip', () => ({
  ChatCostChip: () => null,
}));

// The personal-install choice gate (Task 1.3) lives in localOnlyGuard.
// Stub assertCloudGenerationAllowed as a no-op here — these tests focus on
// workspace-mode wiring, not on the confidentiality-choice gate itself.
vi.mock('@/platform/privacy/localOnlyGuard', async (orig) => {
  const real = await orig<typeof import('@/platform/privacy/localOnlyGuard')>();
  return {
    ...real,
    assertCloudGenerationAllowed: vi.fn(),
  };
});

import { AIChatViewer } from '@/features/ask/AIChatViewer';
import type { AIChatFile } from '@/platform/types/ai';
import { useAIChatStore } from '@/platform/state/aiChatStore';

const chat: AIChatFile = {
  id: 'm2-ask-test',
  title: 'Ask Mode Test',
  created: new Date().toISOString(),
  updated: new Date().toISOString(),
  messages: [],
  provider: 'anthropic',
  model: 'stub',
};

const apiKey = [
  { provider: 'anthropic', key: 'stub-key', isValid: true },
];

describe('Ask-my-workspace chat mode (M2)', () => {
  beforeEach(() => {
    mocks.retrieve.mockReset();
    mocks.sendMessage.mockReset();
    useAIChatStore.setState({ sessions: {}, dailyCosts: {}, askWorkspaceMode: {}, fileAccessConsent: { 'm2-ask-test': { state: 'granted', grantedScope: { kind: 'allMatters' } } } }); // F2.5: ambient retrieval needs file-access consent
    mocks.sendMessage.mockResolvedValue({
      content: 'Hi. [pricing.md paragraph 3]',
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
      cost: 0.0001,
      model: 'stub',
    });
    mocks.retrieve.mockResolvedValue([
      {
        path: 'notes/pricing.md',
        chunkText: 'Premium tier priced at $49.',
        score: 0.9,
        paragraphIndex: 3,
      },
    ]);
  });

  afterEach(() => {
    useAIChatStore.setState({ sessions: {}, dailyCosts: {}, askWorkspaceMode: {}, fileAccessConsent: { 'm2-ask-test': { state: 'granted', grantedScope: { kind: 'allMatters' } } } }); // F2.5: ambient retrieval needs file-access consent
  });

  it('defaults the toggle to OFF', () => {
    render(<AIChatViewer chatData={chat} apiKeys={apiKey} />);
    const toggle = screen.getByTestId('ask-workspace-toggle');
    expect(toggle.getAttribute('data-enabled')).toBe('false');
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
  });

  it('flips to ON when clicked and persists in the store', () => {
    render(<AIChatViewer chatData={chat} apiKeys={apiKey} />);
    const toggle = screen.getByTestId('ask-workspace-toggle');
    act(() => {
      fireEvent.click(toggle);
    });
    expect(toggle.getAttribute('data-enabled')).toBe('true');
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    const stored = useAIChatStore.getState().askWorkspaceMode[chat.id];
    expect(stored).toBe(true);
  });

  it('calls MemoryService.retrieve BEFORE the provider when the toggle is on', async () => {
    const order: string[] = [];
    mocks.retrieve.mockImplementation(async () => {
      order.push('retrieve');
      return [
        {
          path: 'notes/pricing.md',
          chunkText: 'Premium tier priced at $49.',
          score: 0.9,
          paragraphIndex: 3,
        },
      ];
    });
    mocks.sendMessage.mockImplementation(async () => {
      order.push('send');
      return {
        content: 'ok',
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        cost: 0,
        model: 'stub',
      };
    });

    render(<AIChatViewer chatData={chat} apiKeys={apiKey} />);
    act(() => {
      fireEvent.click(screen.getByTestId('ask-workspace-toggle'));
    });

    const textarea = screen.getByTestId('chat-input') as HTMLTextAreaElement;
    act(() => {
      fireEvent.change(textarea, {
        target: { value: 'How did we price premium?' },
      });
    });
    act(() => {
      fireEvent.click(screen.getByTestId('chat-send-button'));
    });

    await waitFor(() => {
      expect(mocks.sendMessage).toHaveBeenCalledTimes(1);
    });

    expect(order[0]).toBe('retrieve');
    expect(order[1]).toBe('send');
    // WS-B/C: retrieval now carries a scope. With no active matter the chat
    // passes the explicit cross-matter ("all matters") scope.
    // WS-PRIV: a 4th arg carries includePrivileged — false by default (exclude).
    expect(mocks.retrieve).toHaveBeenCalledWith(
      'How did we price premium?',
      8,
      { kind: 'allMatters' },
      false,
      undefined,
      false,
      false,
    );
  });

  it('injects the <workspace_context> block into the system prompt', async () => {
    render(<AIChatViewer chatData={chat} apiKeys={apiKey} />);
    act(() => {
      fireEvent.click(screen.getByTestId('ask-workspace-toggle'));
    });

    const textarea = screen.getByTestId('chat-input') as HTMLTextAreaElement;
    act(() => {
      fireEvent.change(textarea, {
        target: { value: 'How did we price premium?' },
      });
    });
    act(() => {
      fireEvent.click(screen.getByTestId('chat-send-button'));
    });

    await waitFor(() => expect(mocks.sendMessage).toHaveBeenCalled());

    const sendArgs = mocks.sendMessage.mock.calls[0];
    expect(sendArgs).toBeDefined();
    const systemPrompt = (sendArgs![1] as { systemPrompt?: string }).systemPrompt!;
    expect(systemPrompt).toContain('<workspace_context>');
    expect(systemPrompt).toContain('[1] notes/pricing.md paragraph 3');
    expect(systemPrompt).toContain('Premium tier priced at $49.');
  });

  it('attaches retrieval sources to the assistant message so the accordion renders', async () => {
    render(<AIChatViewer chatData={chat} apiKeys={apiKey} />);
    act(() => {
      fireEvent.click(screen.getByTestId('ask-workspace-toggle'));
    });

    const textarea = screen.getByTestId('chat-input') as HTMLTextAreaElement;
    act(() => {
      fireEvent.change(textarea, {
        target: { value: 'Pricing?' },
      });
    });
    act(() => {
      fireEvent.click(screen.getByTestId('chat-send-button'));
    });

    await waitFor(() => expect(mocks.sendMessage).toHaveBeenCalled());

    await waitFor(() => {
      expect(
        screen.getAllByTestId('chat-sources-accordion').length,
      ).toBeGreaterThan(0);
    });
  });

  it('does NOT retrieve when the toggle is off and the message has no @workspace tag', async () => {
    render(<AIChatViewer chatData={chat} apiKeys={apiKey} />);
    const textarea = screen.getByTestId('chat-input') as HTMLTextAreaElement;
    act(() => {
      fireEvent.change(textarea, { target: { value: 'Hello world' } });
    });
    act(() => {
      fireEvent.click(screen.getByTestId('chat-send-button'));
    });

    await waitFor(() => expect(mocks.sendMessage).toHaveBeenCalled());
    expect(mocks.retrieve).not.toHaveBeenCalled();
  });

  it('retrieves for the explicit @workspace tag even when the toggle is off', async () => {
    render(<AIChatViewer chatData={chat} apiKeys={apiKey} />);
    const textarea = screen.getByTestId('chat-input') as HTMLTextAreaElement;
    act(() => {
      fireEvent.change(textarea, {
        target: { value: '@workspace tell me about pricing' },
      });
    });
    act(() => {
      fireEvent.click(screen.getByTestId('chat-send-button'));
    });

    await waitFor(() => expect(mocks.sendMessage).toHaveBeenCalled());
    expect(mocks.retrieve).toHaveBeenCalledTimes(1);
    expect(mocks.retrieve.mock.calls[0]![0]).toBe(
      'tell me about pricing',
    );
  });

  it('renders the workspace-command-chip inside the sent user message', async () => {
    render(<AIChatViewer chatData={chat} apiKeys={apiKey} />);
    const textarea = screen.getByTestId('chat-input') as HTMLTextAreaElement;
    act(() => {
      fireEvent.change(textarea, {
        target: { value: '@workspace price summary' },
      });
    });
    act(() => {
      fireEvent.click(screen.getByTestId('chat-send-button'));
    });

    await waitFor(() =>
      expect(screen.getByTestId('workspace-command-chip')).toBeInTheDocument(),
    );
  });
});
