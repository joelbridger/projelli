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

vi.mock('@/platform/rag/MemoryService', async (orig) => {
  const real = await orig<typeof import('@/platform/rag/MemoryService')>();
  return {
    ...real,
    MemoryService: { ...real.MemoryService, retrieve: mocks.retrieve },
    isMemoryEnabled: () => true,
  };
});

// verifyCitations (in workspaceCommand) calls ragVerifyCitationsBatch (P2.1) —
// mock the batch wrapper; it returns one verdict per input citation, in order.
vi.mock('@/platform/utils/tauri-commands', async (orig) => {
  const real = await orig<typeof import('@/platform/utils/tauri-commands')>();
  return { ...real, ragVerifyCitationsBatch: mocks.verifyCitation };
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

vi.mock('@/features/ask/ChatCostChip', () => ({ ChatCostChip: () => null }));

// The personal-install choice gate (Task 1.3) lives in localOnlyGuard.
// Stub assertCloudGenerationAllowed as a no-op here — these tests focus on
// matter-scoped retrieval wiring, not on the confidentiality-choice gate itself.
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
import { useMatterStore } from '@/platform/matter/matterStore';
import {
  issueAllMattersScopeSelection,
  issueMatterScopeSelection,
  requestClearClientSelection,
  requestMatterScopeSelection,
  useClientContextStore,
} from '@/platform/client-context';
import { setDevFlagOverride } from '@/platform/flags/router';

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

async function seedMatter() {
  useMatterStore.setState({ matters: [], activeMatterId: null });
  const m = useMatterStore.getState().createMatter({
    name: 'Acme v. Beta',
    client: 'Acme Corp',
    folderPaths: ['/ws/Acme'],
  });
  await requestMatterScopeSelection(issueMatterScopeSelection(m.id));
  await waitFor(() => {
    expect(useMatterStore.getState().activeMatterId).toBe(m.id);
    expect(useClientContextStore.getState().followerStatus).toBe('converged');
  });
  return m;
}

describe('WS-B/C scoped cited retrieval in chat', () => {
  beforeEach(async () => {
    mocks.retrieve.mockReset();
    mocks.sendMessage.mockReset();
    mocks.verifyCitation.mockReset();
    useAIChatStore.setState({ sessions: {}, dailyCosts: {}, askWorkspaceMode: {}, fileAccessConsent: { 'wsbc-scope-test': { state: 'granted', grantedScope: { kind: 'allMatters' } } } }); // F2.5: ambient retrieval needs file-access consent
    useMatterStore.setState({ matters: [], activeMatterId: null });
    setDevFlagOverride('selection-authority-boot-gate', false);
    requestClearClientSelection();
    setDevFlagOverride('selection-authority-boot-gate', true);
    await requestMatterScopeSelection(issueAllMattersScopeSelection());

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
    mocks.verifyCitation.mockImplementation((cites?: { id: string }[]) =>
      Promise.resolve((cites ?? []).map(() => ({ verdict: 'verified' as const }))),
    );
  });

  afterEach(() => {
    useAIChatStore.setState({ sessions: {}, dailyCosts: {}, askWorkspaceMode: {}, fileAccessConsent: { 'wsbc-scope-test': { state: 'granted', grantedScope: { kind: 'allMatters' } } } }); // F2.5: ambient retrieval needs file-access consent
    useMatterStore.setState({ matters: [], activeMatterId: null });
    setDevFlagOverride('selection-authority-boot-gate', false);
    requestClearClientSelection();
    setDevFlagOverride('selection-authority-boot-gate', undefined);
  });

  it('retrieves with the ACTIVE matter scope, not all-matters', async () => {
    const m = await seedMatter();
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
    // WS-PRIV: a 4th arg carries includePrivileged — false by default (exclude).
    expect(mocks.retrieve).toHaveBeenCalledWith(
      'pricing?',
      8,
      { kind: 'matter', matterId: m.id },
      false,
      undefined,
      false,
      false,
    );
  });

  it('uses the explicit all-matters scope when no matter is active', async () => {
    // no seedMatter — activeMatterId stays null
    render(<AIChatViewer chatData={chat} apiKeys={apiKey} />);
    act(() => fireEvent.click(screen.getByTestId('ask-workspace-toggle')));
    const textarea = screen.getByTestId('chat-input') as HTMLTextAreaElement;
    act(() => fireEvent.change(textarea, { target: { value: 'pricing?' } }));
    act(() => fireEvent.click(screen.getByTestId('chat-send-button')));

    await waitFor(() => expect(mocks.sendMessage).toHaveBeenCalled());
    expect(mocks.retrieve).toHaveBeenCalledWith(
      'pricing?',
      8,
      { kind: 'allMatters' },
      false,
      undefined,
      false,
      false,
    );
  });

  it('shows the active matter in the scope selector', async () => {
    await seedMatter();
    render(<AIChatViewer chatData={chat} apiKeys={apiKey} />);
    const selector = screen.getByTestId('matter-scope-selector');
    expect(selector.getAttribute('data-scope')).toBe('matter');
    expect(selector.getAttribute('data-source-scope')).toBe('matter-only');
    expect(selector.textContent).toContain('Acme');
  });

  it('stamps a "Scoped to" indicator on the assistant reply', async () => {
    await seedMatter();
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
    const m = await seedMatter();
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
    mocks.verifyCitation.mockImplementation((cites?: { id: string }[]) =>
      Promise.resolve((cites ?? []).map(() => ({ verdict: 'textMismatch' as const }))),
    );

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
    const m = await seedMatter();
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
    mocks.verifyCitation.mockImplementation((cites?: { id: string }[]) =>
      Promise.resolve((cites ?? []).map(() => ({ verdict: 'verified' as const }))),
    );
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
    // F-504: the cited chunk's text rides along so the editor can scroll
    // to the exact passage.
    expect(onOpen).toHaveBeenCalledWith(
      'Acme/pricing.md',
      3,
      'Premium tier priced at $49.',
    );
    // no unverified warning when everything verifies
    expect(
      screen.queryByTestId('chat-message-1-unverified-warning'),
    ).not.toBeInTheDocument();
  });
});
