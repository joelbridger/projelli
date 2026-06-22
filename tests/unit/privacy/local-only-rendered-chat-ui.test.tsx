/**
 * TEST-005 — Local-only must be enforced through the rendered chat UI.
 *
 * The lower-level guard is already unit-tested. This test drives the real
 * AIChatViewer with React Testing Library: a saved cloud-provider chat is open,
 * Local-only mode is active, and a valid cloud key exists. Pressing Send must
 * surface a blocking error and never construct or call a cloud provider.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  claudeCtor: vi.fn(),
  openaiCtor: vi.fn(),
  geminiCtor: vi.fn(),
  cloudSend: vi.fn(),
  cloudStream: vi.fn(),
  ollamaCtor: vi.fn(),
  ollamaSend: vi.fn(),
}));

vi.mock('@/platform/providers/ClaudeProvider', () => ({
  ClaudeProvider: class {
    constructor(cfg: unknown) { mocks.claudeCtor(cfg); }
    setTools() {}
    sendMessage = mocks.cloudSend;
    sendMessageStreaming = mocks.cloudStream;
    getMetadata() { return { model: 'claude-stub' }; }
  },
}));

vi.mock('@/platform/providers/OpenAIProvider', () => ({
  OpenAIProvider: class {
    constructor(cfg: unknown) { mocks.openaiCtor(cfg); }
    setTools() {}
    sendMessage = mocks.cloudSend;
    sendMessageStreaming = mocks.cloudStream;
    getMetadata() { return { model: 'openai-stub' }; }
  },
}));

vi.mock('@/platform/providers/GeminiProvider', () => ({
  GeminiProvider: class {
    constructor(cfg: unknown) { mocks.geminiCtor(cfg); }
    setTools() {}
    sendMessage = mocks.cloudSend;
    sendMessageStreaming = mocks.cloudStream;
    getMetadata() { return { model: 'gemini-stub' }; }
  },
}));

vi.mock('@/platform/providers/OllamaProvider', () => {
  class OllamaProvider {
    constructor(cfg: unknown) { mocks.ollamaCtor(cfg); }
    setTools() {}
    sendMessage = mocks.ollamaSend;
    sendMessageStreaming = undefined;
    getMetadata() {
      return {
        providerId: 'ollama',
        model: 'llama3.2:3b',
        costPerInputToken: 0,
        costPerOutputToken: 0,
      };
    }
  }
  return {
    OllamaProvider,
    OLLAMA_DEFAULT_MODEL: 'llama3.2:3b',
    OLLAMA_DEFAULT_BASE_URL: 'http://127.0.0.1:11434',
    createOllamaProvider: (cfg: unknown) => new OllamaProvider(cfg),
    detectOllama: vi.fn(async () => ({ reachable: true, models: ['llama3.2:3b'] })),
    formatOllamaDisplayName: (name: string) => name,
  };
});

vi.mock('@/features/ask/ChatCostChip', () => ({ ChatCostChip: () => null }));

import { AIChatViewer } from '@/features/ask/AIChatViewer';
import type { AIChatFile } from '@/platform/types/ai';
import { useAIChatStore } from '@/platform/state/aiChatStore';
import { useSettingsStore } from '@/platform/settings/settingsStore';
import { CONFIDENTIALITY_MODE_SETTING_KEY } from '@/platform/privacy/egress';

const cloudChat: AIChatFile = {
  id: 'test-005-local-only-rendered-chat',
  title: 'Cloud chat opened in Local-only mode',
  created: new Date().toISOString(),
  updated: new Date().toISOString(),
  messages: [],
  provider: 'anthropic',
  model: 'claude-3-5-sonnet-latest',
};

function resetStores() {
  useAIChatStore.setState({ sessions: {}, dailyCosts: {}, askWorkspaceMode: {} });
  useSettingsStore.setState({ values: {} });
  useSettingsStore.getState().setSetting(CONFIDENTIALITY_MODE_SETTING_KEY, 'local-only');
}

describe('TEST-005 — Local-only rendered chat UI enforcement', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
    vi.spyOn(console, 'error').mockImplementation(() => {});
    for (const mock of Object.values(mocks)) {
      mock.mockReset();
    }
    resetStores();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    resetStores();
  });

  it('blocks a cloud-backed chat in Local-only mode before any cloud send can happen', async () => {
    render(
      <AIChatViewer
        chatData={cloudChat}
        apiKeys={[{ provider: 'anthropic', key: 'sk-ant-test', isValid: true }]}
      />,
    );

    await screen.findByTestId('chat-input');
    for (const mock of Object.values(mocks)) {
      mock.mockClear();
    }

    act(() => {
      fireEvent.change(screen.getByTestId('chat-input'), {
        target: { value: 'Summarize this confidential matter.' },
      });
    });
    act(() => {
      fireEvent.click(screen.getByTestId('chat-send-button'));
    });

    await screen.findByText(/Local-only mode is on/i);
    await waitFor(() => expect(screen.getByText(/nothing can be sent to a cloud AI provider/i)).toBeTruthy());

    expect(mocks.claudeCtor).not.toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: 'sk-ant-test' }),
    );
    expect(mocks.openaiCtor).not.toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: 'sk-ant-test' }),
    );
    expect(mocks.geminiCtor).not.toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: 'sk-ant-test' }),
    );
    expect(mocks.cloudSend).not.toHaveBeenCalled();
    expect(mocks.cloudStream).not.toHaveBeenCalled();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
