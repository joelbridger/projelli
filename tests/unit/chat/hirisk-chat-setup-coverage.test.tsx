/// <reference types="@testing-library/jest-dom" />

import { useState } from 'react';
import type { ReactElement } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

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
    getMetadata() {
      return { model: 'stub', costPerInputToken: 0.000001 };
    }
  },
}));

vi.mock('@/platform/providers/OpenAIProvider', () => ({
  OpenAIProvider: class {
    setTools() {}
    sendMessage = mocks.sendMessage;
    sendMessageStreaming = undefined;
    getMetadata() {
      return { model: 'stub', costPerInputToken: 0.000001 };
    }
  },
}));

vi.mock('@/platform/providers/GeminiProvider', () => ({
  GeminiProvider: class {
    setTools() {}
    sendMessage = mocks.sendMessage;
    sendMessageStreaming = undefined;
    getMetadata() {
      return { model: 'stub', costPerInputToken: 0.000001 };
    }
  },
}));

vi.mock('@/platform/providers/OllamaProvider', () => ({
  OllamaProvider: class {
    setTools() {}
    sendMessage = mocks.sendMessage;
    sendMessageStreaming = undefined;
    getMetadata() {
      return { model: 'stub', costPerInputToken: 0 };
    }
  },
  detectOllama: vi.fn(async () => ({ reachable: true, models: ['llama3.2:3b'] })),
}));

vi.mock('@/features/ask/ChatCostChip', () => ({
  ChatCostChip: () => null,
  formatCostShort: (cost: number) => `$${cost.toFixed(4)}`,
}));

vi.mock('@/platform/hooks/useTrial', () => ({
  useTrialGate: () => ({
    isLocked: false,
    daysRemaining: 30,
    isTrialExpired: false,
    isActivated: true,
    trialDays: 30,
  }),
}));

vi.mock('@/platform/privacy/ui/EgressIndicator', () => ({
  EgressIndicator: () => <div data-testid="egress-indicator-stub" />,
}));

vi.mock('@/platform/utils/openExternal', () => ({
  openExternal: vi.fn(async () => {}),
}));

import { AIChatViewer } from '@/features/ask/AIChatViewer';
import { ScopeToggle } from '@/features/ask/ScopeToggle';
import { AiSetupStep } from '@/features/onboarding/AiSetupStep';
import type { AskScope } from '@/features/ask/askHelpers';
import type { AIChatFile } from '@/platform/types/ai';
import type { AuditEntry } from '@/platform/types/audit';
import type { ExtractedContext } from '@/platform/utils/ai-file-context';
import { useAIChatStore } from '@/platform/state/aiChatStore';
import { useFileContextStore } from '@/platform/state/fileContextStore';
import { useMatterStore } from '@/platform/matter/matterStore';
import { useSettingsStore } from '@/platform/settings/settingsStore';
import { CONFIDENTIALITY_CHOICE_MADE_KEY } from '@/platform/privacy/resolvePersonalEgressDefault';
import { CONFIDENTIALITY_MODE_SETTING_KEY } from '@/platform/privacy/egress';
import { TooltipProvider } from '@/ui/tooltip';

const apiKey = [{ provider: 'anthropic', key: 'stub-key', isValid: true }];

function makeChat(id: string, messages: AIChatFile['messages'] = []): AIChatFile {
  return {
    id,
    title: 'High-risk chat test',
    created: '2026-06-19T00:00:00.000Z',
    updated: '2026-06-19T00:00:00.000Z',
    messages,
    provider: 'anthropic',
    model: 'stub',
  };
}

function context(path: string, text: string): ExtractedContext {
  const fileName = path.split('/').pop() ?? path;
  return {
    path,
    fileName,
    extractedText: text,
    tokenEstimate: Math.ceil(text.length / 4),
    truncated: false,
    sourceKind: 'text',
  };
}

function resetStores() {
  useAIChatStore.setState({
    sessions: {},
    dailyCosts: {},
    askWorkspaceMode: {},
  });
  useFileContextStore.setState({ contexts: {}, disabledPaths: {} });
  useMatterStore.setState({ matters: [], activeMatterId: null });
  useSettingsStore.setState({ values: {} });
  // Mark the confidentiality choice as made so the Task 1.3 gate is a no-op
  // in these tests, which focus on chat wiring, not the choice gate itself.
  localStorage.clear();
  sessionStorage.clear();
  // Set these AFTER the clears, via setSetting, so they live in the in-memory
  // store AND are persisted to localStorage (and survive a later re-persist):
  //  - the choice flag makes the Task 1.3 gate a no-op;
  //  - 'direct' mode makes the fail-closed cloud-send guard allow chat sends
  //    (these tests exercise chat wiring, not private mode).
  useSettingsStore.getState().setSetting(CONFIDENTIALITY_CHOICE_MADE_KEY, true);
  useSettingsStore.getState().setSetting(CONFIDENTIALITY_MODE_SETTING_KEY, 'direct');
}

function renderChat(element: ReactElement) {
  return render(
    <TooltipProvider>
      {element}
    </TooltipProvider>,
  );
}

describe('High-risk chat/setup coverage from the current UI', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStores();
    mocks.retrieve.mockResolvedValue([]);
    mocks.sendMessage.mockResolvedValue({
      content: 'Done.',
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      cost: 0,
      model: 'stub',
    });
  });

  afterEach(() => {
    resetStores();
  });

  it('CHAT-26 blocks an over-limit send and shows the compression / send-anyway warning', async () => {
    useSettingsStore.setState({
      values: {
        chatContextTokenLimit: 10000,
        keepRecentTurns: 6,
        // Keep the Task 1.3 gate open so the test reaches the context-limit logic.
        confidentialityChoiceMade: true,
        // Non-private mode so the fail-closed cloud-send guard allows the send
        // (this setState replaces `values`, so the mode must be restated here).
        confidentialityMode: 'direct',
      },
    });

    const chat = makeChat('chat-26-over-limit');
    const auditEntries: Omit<AuditEntry, 'id' | 'timestamp'>[] = [];
    renderChat(
      <AIChatViewer
        chatData={chat}
        apiKeys={apiKey}
        onAuditLog={(entry) => auditEntries.push(entry)}
      />,
    );

    const input = screen.getByTestId('chat-input') as HTMLTextAreaElement;
    const longMessage = [
      'This message is intentionally long enough to exceed the valid test token limit.',
      'privileged context '.repeat(3000),
    ].join(' ');
    fireEvent.change(input, {
      target: { value: longMessage },
    });
    fireEvent.click(screen.getByTestId('chat-send-button'));

    expect(await screen.findByTestId('compression-confirm-modal')).toBeInTheDocument();
    expect(screen.getByTestId('modal-send-anyway-btn')).toBeInTheDocument();
    expect(screen.getByTestId('modal-compress-btn')).toBeInTheDocument();
    expect(mocks.sendMessage).not.toHaveBeenCalled();
    expect(useAIChatStore.getState().sessions[chat.id]?.messages ?? []).toHaveLength(0);
    expect(input.value).toContain('intentionally long');
    expect(
      auditEntries.some((entry) => entry.action === 'egress'),
    ).toBe(false);

    fireEvent.click(screen.getByTestId('modal-send-anyway-btn'));
    await waitFor(() => expect(mocks.sendMessage).toHaveBeenCalledTimes(1));
  });

  it('CHAT-34 changes the Ask retrieval scope chip safely between matter, all matters, email, and documents', () => {
    function ScopeHarness() {
      const [scope, setScope] = useState<AskScope>('this-matter');
      return (
        <ScopeToggle
          scope={scope}
          onChange={setScope}
          hasMatter
          isSample={false}
        />
      );
    }

    render(<ScopeHarness />);

    expect(screen.getByTestId('scope-option-this-matter')).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(screen.getByTestId('scope-option-all-matters'));
    expect(screen.getByTestId('scope-option-all-matters')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('scope-option-this-matter')).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(screen.getByTestId('scope-option-email'));
    expect(screen.getByTestId('scope-option-email')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('scope-option-all-matters')).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(screen.getByTestId('scope-option-documents'));
    expect(screen.getByTestId('scope-option-documents')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('scope-option-email')).toHaveAttribute('aria-pressed', 'false');
  });

  it('CHAT-16 scopes chat context to one client folder and excludes the other folder from the AI prompt', async () => {
    const rootPath = '/workspace';
    useFileContextStore.setState({
      contexts: {
        '/workspace/Acme/memo.md': context('/workspace/Acme/memo.md', 'Acme open-file strategy only.'),
        '/workspace/Beta/memo.md': context('/workspace/Beta/memo.md', 'Beta open-file strategy only.'),
      },
      disabledPaths: {},
    });
    mocks.retrieve.mockResolvedValue([
      {
        path: '/workspace/Acme/memo.md',
        chunkText: 'Acme retrieved fact only.',
        score: 0.95,
        paragraphIndex: 1,
      },
      {
        path: '/workspace/Beta/memo.md',
        chunkText: 'Beta retrieved fact only.',
        score: 0.91,
        paragraphIndex: 1,
      },
    ]);

    const chat = makeChat('chat-16-folder-scope');
    renderChat(<AIChatViewer chatData={chat} apiKeys={apiKey} rootPath={rootPath} />);

    expect(await screen.findByTestId('ai-context-cross-client-warning')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('scope-folder-trigger'));
    fireEvent.click(screen.getByTestId('scope-option-Acme'));

    expect(await screen.findByTestId('ai-context-scope-active-banner')).toHaveTextContent('Acme');
    expect(screen.queryByTestId('ai-context-cross-client-warning')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('ask-workspace-toggle'));
    const input = screen.getByTestId('chat-input') as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: 'What should I know?' } });
    fireEvent.click(screen.getByTestId('chat-send-button'));

    await waitFor(() => expect(mocks.sendMessage).toHaveBeenCalledTimes(1));

    const options = mocks.sendMessage.mock.calls[0]?.[1] as { systemPrompt?: string } | undefined;
    const systemPrompt = options?.systemPrompt ?? '';
    expect(systemPrompt).toContain('Acme open-file strategy only.');
    expect(systemPrompt).toContain('Acme retrieved fact only.');
    expect(systemPrompt).not.toContain('Beta open-file strategy only.');
    expect(systemPrompt).not.toContain('Beta retrieved fact only.');
  });

  it('AS-06 shows an inline onboarding error when saving a rejected AI key', async () => {
    const onSaveKey = vi.fn(async () => {
      throw new Error('That key was refused by the provider.');
    });
    const onUseLocal = vi.fn();
    const onSkip = vi.fn();

    render(
      <AiSetupStep
        onBack={vi.fn()}
        onSaveKey={onSaveKey}
        onUseLocal={onUseLocal}
        onSkip={onSkip}
        onOpenDataMap={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByTestId('ai-path-own-account'));
    fireEvent.change(screen.getByTestId('ai-setup-key-input'), {
      target: { value: 'sk-ant-api03-rejected' },
    });
    fireEvent.click(screen.getByTestId('ai-setup-save-key'));

    const error = await screen.findByTestId('ai-setup-save-error');
    expect(error).toHaveTextContent('That key was refused by the provider.');
    expect(onSaveKey).toHaveBeenCalledWith('anthropic', 'sk-ant-api03-rejected');
    expect(onUseLocal).not.toHaveBeenCalled();
    expect(onSkip).not.toHaveBeenCalled();
    expect(screen.getByTestId('ai-setup-step')).toBeInTheDocument();
  });
});
