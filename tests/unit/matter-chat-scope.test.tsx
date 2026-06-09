/**
 * WS-B/C app — scoped, cited, verified retrieval in the chat (the wedge).
 *
 * Asserts:
 *   1. When a matter is ACTIVE, sending a workspace-aware message calls
 *      MemoryService.retrieve with `{ kind: 'matter', matterId }` — NOT the
 *      all-matters scope.
 *   2. The active-matter scope selector reflects the active matter, and the
 *      assistant reply shows a "Scoped to <matter>" indicator.
 *   3. Citation verification gating: a citation whose source fails
 *      rag_verify_citation is flagged (data-verified="false") and the
 *      unverified-warning strip renders.
 *   4. A verified citation renders normally and clicking it opens the source
 *      via onOpenFileAtPath.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  retrieve: vi.fn(),
  sendMessage: vi.fn(),
  verifyCitation: vi.fn(),
}));

vi.mock('@/modules/memory/MemoryService', async (orig) => {
  const real = await orig<typeof import('@/modules/memory/MemoryService')>();
  return {
    ...real,
    MemoryService: { ...real.MemoryService, retrieve: mocks.retrieve },
    isMemoryEnabled: () => true,
  };
});

// verifyCitations (in workspaceCommand) calls ragVerifyCitation — mock the
// underlying Tauri wrapper so we control the verdict.
vi.mock('@/utils/tauri-commands', async (orig) => {
  const real = await orig<typeof import('@/utils/tauri-commands')>();
  return { ...real, ragVerifyCitation: mocks.verifyCitation };
});

vi.mock('@/modules/models/ClaudeProvider', () => ({
  ClaudeProvider: class {
    setTools() {}
    sendMessage = mocks.sendMessage;
    sendMessageStreaming = undefined;
    getMetadata() { return { model: 'stub' }; }
  },
}));
vi.mock('@/modules/models/OpenAIProvider', () => ({
  OpenAIProvider: class {
    setTools() {}
    sendMessage = mocks.sendMessage;
    sendMessageStreaming = undefined;
    getMetadata() { return { model: 'stub' }; }
  },
}));
vi.mock('@/modules/models/GeminiProvider', () => ({
  GeminiProvider: class {
    setTools() {}
    sendMessage = mocks.sendMessage;
    sendMessageStreaming = undefined;
    getMetadata() { return { model: 'stub' }; }
  },
}));

vi.mock('@/components/ai/ChatCostChip', () => ({ ChatCostChip: () => null }));

import { AIChatViewer } from '@/components/ai/AIChatViewer';
import type { AIChatFile } from '@/types/ai';
import { useAIChatStore } from '@/stores/aiChatStore';
import { useMatterStore } from '@/stores/matterStore';

const chat: AIChatFile = {
  id: 'wsbc-scope-test',
  title: 'Scope Test',
  created: new Date().toISOString(),
  updated: new Date().toISOString(),
  messages: [],
  provider: 'anthropic',
  model: 'stub',
};

const apiKey = [{ provider: 'anthropic', key: 'stub-key', isValid: true }];

function seedMatter() {
  useMatterStore.setState({ matters: [], activeMatterId: null });
  const m = useMatterStore.getState().createMatter({
    name: 'Acme v. Beta',
    client: 'Acme Corp',
    folderPaths: ['/ws/Acme'],
  });
  useMatterStore.getState().setActiveMatter(m.id);
  return m;
}

describe('WS-B/C scoped cited retrieval in chat', () => {
  beforeEach(() => {
    mocks.retrieve.mockReset();
    mocks.sendMessage.mockReset();
    mocks.verifyCitation.mockReset();
    useAIChatStore.setState({ sessions: {}, dailyCosts: {}, askWorkspaceMode: {} });
    useMatterStore.setState({ matters: [], activeMatterId: null });

    mocks.retrieve.mockResolvedValue([
      {
        path: 'Acme/pricing.md',
        chunkText: 'Premium tier priced at $49.',
        score: 0.9,
        paragraphIndex: 3,
        id: 'chunk-1',
        matterId: 'will-be-overwritten',
        sourceId: '/ws/Acme/pricing.md',
      },
    ]);
    mocks.sendMessage.mockResolvedValue({
      content: 'Priced at $49 [pricing.md paragraph 3].',
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
      cost: 0.0001,
      model: 'stub',
    });
    mocks.verifyCitation.mockResolvedValue({ verdict: 'verified' });
  });

  afterEach(() => {
    useAIChatStore.setState({ sessions: {}, dailyCosts: {}, askWorkspaceMode: {} });
    useMatterStore.setState({ matters: [], activeMatterId: null });
  });

  it('retrieves with the ACTIVE matter scope, not all-matters', async () => {
    const m = seedMatter();
    // make the hit carry the active matter id so verification "claims" it
    mocks.retrieve.mockResolvedValue([
      {
        path: 'Acme/pricing.md',
        chunkText: 'Premium tier priced at $49.',
        score: 0.9,
        paragraphIndex: 3,
        id: 'chunk-1',
        matterId: m.id,
        sourceId: '/ws/Acme/pricing.md',
      },
    ]);

    render(<AIChatViewer chatData={chat} apiKeys={apiKey} />);
    act(() => fireEvent.click(screen.getByTestId('ask-workspace-toggle')));
    const textarea = screen.getByTestId('chat-input') as HTMLTextAreaElement;
    act(() => fireEvent.change(textarea, { target: { value: 'pricing?' } }));
    act(() => fireEvent.click(screen.getByTestId('chat-send-button')));

    await waitFor(() => expect(mocks.sendMessage).toHaveBeenCalled());
    expect(mocks.retrieve).toHaveBeenCalledWith('pricing?', 8, {
      kind: 'matter',
      matterId: m.id,
    });
  });

  it('uses the explicit all-matters scope when no matter is active', async () => {
    // no seedMatter — activeMatterId stays null
    render(<AIChatViewer chatData={chat} apiKeys={apiKey} />);
    act(() => fireEvent.click(screen.getByTestId('ask-workspace-toggle')));
    const textarea = screen.getByTestId('chat-input') as HTMLTextAreaElement;
    act(() => fireEvent.change(textarea, { target: { value: 'pricing?' } }));
    act(() => fireEvent.click(screen.getByTestId('chat-send-button')));

    await waitFor(() => expect(mocks.sendMessage).toHaveBeenCalled());
    expect(mocks.retrieve).toHaveBeenCalledWith('pricing?', 8, {
      kind: 'allMatters',
    });
  });

  it('shows the active matter in the scope selector', () => {
    seedMatter();
    render(<AIChatViewer chatData={chat} apiKeys={apiKey} />);
    const selector = screen.getByTestId('matter-scope-selector');
    expect(selector.getAttribute('data-scope')).toBe('matter');
    expect(selector.textContent).toContain('Acme');
  });

  it('stamps a "Scoped to" indicator on the assistant reply', async () => {
    seedMatter();
    render(<AIChatViewer chatData={chat} apiKeys={apiKey} />);
    act(() => fireEvent.click(screen.getByTestId('ask-workspace-toggle')));
    const textarea = screen.getByTestId('chat-input') as HTMLTextAreaElement;
    act(() => fireEvent.change(textarea, { target: { value: 'pricing?' } }));
    act(() => fireEvent.click(screen.getByTestId('chat-send-button')));

    await waitFor(() => expect(mocks.sendMessage).toHaveBeenCalled());
    // assistant message is index 1 (user is 0)
    await waitFor(() => {
      const scope = screen.getByTestId('chat-message-1-scope');
      expect(scope.getAttribute('data-scope-kind')).toBe('matter');
    });
  });

  it('flags an unverified citation and shows the warning strip', async () => {
    const m = seedMatter();
    mocks.retrieve.mockResolvedValue([
      {
        path: 'Acme/pricing.md',
        chunkText: 'Premium tier priced at $49.',
        score: 0.9,
        paragraphIndex: 3,
        id: 'chunk-1',
        matterId: m.id,
        sourceId: '/ws/Acme/pricing.md',
      },
    ]);
    // verification fails — the model misquoted / fabricated.
    mocks.verifyCitation.mockResolvedValue({ verdict: 'textMismatch' });

    render(<AIChatViewer chatData={chat} apiKeys={apiKey} />);
    act(() => fireEvent.click(screen.getByTestId('ask-workspace-toggle')));
    const textarea = screen.getByTestId('chat-input') as HTMLTextAreaElement;
    act(() => fireEvent.change(textarea, { target: { value: 'pricing?' } }));
    act(() => fireEvent.click(screen.getByTestId('chat-send-button')));

    await waitFor(() => expect(mocks.sendMessage).toHaveBeenCalled());

    // The citation chip is marked unverified, and the warning strip renders.
    await waitFor(() => {
      const chip = screen.getByTestId('chat-citation-pricing.md-3');
      expect(chip.getAttribute('data-verified')).toBe('false');
    });
    expect(
      screen.getByTestId('chat-message-1-unverified-warning'),
    ).toBeInTheDocument();
  });

  it('marks a verified citation safe and clicking it opens the source', async () => {
    const m = seedMatter();
    mocks.retrieve.mockResolvedValue([
      {
        path: 'Acme/pricing.md',
        chunkText: 'Premium tier priced at $49.',
        score: 0.9,
        paragraphIndex: 3,
        id: 'chunk-1',
        matterId: m.id,
        sourceId: '/ws/Acme/pricing.md',
      },
    ]);
    mocks.verifyCitation.mockResolvedValue({ verdict: 'verified' });
    const onOpen = vi.fn();

    render(
      <AIChatViewer chatData={chat} apiKeys={apiKey} onOpenFileAtPath={onOpen} />,
    );
    act(() => fireEvent.click(screen.getByTestId('ask-workspace-toggle')));
    const textarea = screen.getByTestId('chat-input') as HTMLTextAreaElement;
    act(() => fireEvent.change(textarea, { target: { value: 'pricing?' } }));
    act(() => fireEvent.click(screen.getByTestId('chat-send-button')));

    await waitFor(() => expect(mocks.sendMessage).toHaveBeenCalled());

    const chip = await screen.findByTestId('chat-citation-pricing.md-3');
    expect(chip.getAttribute('data-verified')).toBe('true');
    act(() => fireEvent.click(chip));
    expect(onOpen).toHaveBeenCalledWith('Acme/pricing.md', 3);
    // no unverified warning when everything verifies
    expect(
      screen.queryByTestId('chat-message-1-unverified-warning'),
    ).not.toBeInTheDocument();
  });
});
