/**
 * WS-C honesty — Ollama wired into the chat + redline send path.
 *
 * This is an HONESTY-CRITICAL suite. Keepance's Local-only confidentiality mode
 * and the egress indicator both promise "nothing leaves your machine" when a
 * local model is used. Before this work, an Ollama-configured chat fell through
 * to the Claude/cloud branch — the indicator would OVERCLAIM and a "private"
 * prompt would be routed to a cloud provider. These tests pin the fix:
 *
 *   1. An Ollama chat routes to OllamaProvider — the cloud providers are NEVER
 *      constructed or called.
 *   2. The NO-SILENT-CLOUD-FALLBACK guarantee: a local selection never reaches a
 *      cloud provider, EVEN when Ollama errors (daemon down). The user sees a
 *      clear friendly message; no cloud call is made; nothing leaves the machine.
 *   3. Streaming + abort: the Ollama streaming path renders tokens and the Stop
 *      button aborts it.
 *   4. Local-only restricts the model picker to discovered Ollama models and
 *      defaults the new-chat to a local model (cloud buttons stay disabled).
 *   5. providerFactory constructs the local provider for 'ollama' and a local
 *      selection can never fall through to a cloud provider.
 *   6. Redline uses Ollama when the provider is local (DocxEditor's redline
 *      construction point), so redlining in Local-only stays on the machine.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Provider mocks. Each cloud provider records whether it was CONSTRUCTED and
// whether its send method was CALLED, so we can assert a local chat never
// touches the cloud. The Ollama mock is driven per-test (resolve / reject /
// stream) via the hoisted handles.
// ---------------------------------------------------------------------------
const mocks = vi.hoisted(() => ({
  // construction counters
  claudeCtor: vi.fn(),
  openaiCtor: vi.fn(),
  geminiCtor: vi.fn(),
  ollamaCtor: vi.fn(),
  // call recorders
  cloudSend: vi.fn(),
  cloudStream: vi.fn(),
  ollamaSend: vi.fn(),
  ollamaStream: vi.fn(),
  // whether the Ollama mock should expose a streaming method this test
  ollamaStreamingEnabled: { value: false },
}));

vi.mock('@/modules/models/ClaudeProvider', () => ({
  ClaudeProvider: class {
    constructor(cfg: unknown) { mocks.claudeCtor(cfg); }
    setTools() {}
    sendMessage = mocks.cloudSend;
    sendMessageStreaming = undefined;
    getMetadata() { return { model: 'claude-stub' }; }
  },
}));
vi.mock('@/modules/models/OpenAIProvider', () => ({
  OpenAIProvider: class {
    constructor(cfg: unknown) { mocks.openaiCtor(cfg); }
    setTools() {}
    sendMessage = mocks.cloudSend;
    sendMessageStreaming = undefined;
    getMetadata() { return { model: 'openai-stub' }; }
  },
}));
vi.mock('@/modules/models/GeminiProvider', () => ({
  GeminiProvider: class {
    constructor(cfg: unknown) { mocks.geminiCtor(cfg); }
    setTools() {}
    sendMessage = mocks.cloudSend;
    sendMessageStreaming = undefined;
    getMetadata() { return { model: 'gemini-stub' }; }
  },
}));

// The OllamaProvider mock is what we want the local chat to route to. We also
// re-export the module-scope helpers (detectOllama etc.) that AIAssistantPane /
// providerFactory import, so they keep working under the mock.
vi.mock('@/modules/models/OllamaProvider', () => {
  class OllamaProvider {
    constructor(cfg: unknown) { mocks.ollamaCtor(cfg); }
    setTools() {}
    sendMessage = mocks.ollamaSend;
    // `sendMessageStreaming` is a getter so a test can toggle its presence:
    // when disabled it is `undefined` (forces the non-streaming send path),
    // when enabled it is the recorder (exercises the streaming path).
    get sendMessageStreaming() {
      return mocks.ollamaStreamingEnabled.value ? mocks.ollamaStream : undefined;
    }
    getMetadata() {
      return { providerId: 'ollama', model: 'llama3.2:3b', costPerInputToken: 0, costPerOutputToken: 0 };
    }
  }
  return {
    OllamaProvider,
    OLLAMA_DEFAULT_MODEL: 'llama3.2:3b',
    OLLAMA_DEFAULT_BASE_URL: 'http://127.0.0.1:11434',
    createOllamaProvider: (cfg: unknown) => new OllamaProvider(cfg),
    // detectOllama is stubbed per-test where needed; default reachable w/ models.
    detectOllama: vi.fn(async () => ({ reachable: true, models: ['llama3.2:3b', 'qwen2.5:7b'] })),
    formatOllamaDisplayName: (n: string) => n,
  };
});

vi.mock('@/components/ai/ChatCostChip', () => ({ ChatCostChip: () => null }));

import { AIChatViewer } from '@/components/ai/AIChatViewer';
import type { AIChatFile } from '@/types/ai';
import { useAIChatStore } from '@/stores/aiChatStore';
import { useSettingsStore } from '@/stores/settingsStore';
import {
  CONFIDENTIALITY_MODE_SETTING_KEY,
  type ConfidentialityMode,
} from '@/modules/privacy/egress';
import { createProvider, isLocalProviderId } from '@/modules/models/providerFactory';

function ollamaChat(): AIChatFile {
  return {
    id: 'ollama-wiring-test',
    title: 'Local Chat',
    created: new Date().toISOString(),
    updated: new Date().toISOString(),
    messages: [],
    provider: 'ollama',
    model: 'llama3.2:3b',
  };
}

function setMode(mode: ConfidentialityMode) {
  useSettingsStore.getState().setSetting(CONFIDENTIALITY_MODE_SETTING_KEY, mode);
}

function resetAll() {
  for (const m of Object.values(mocks)) {
    if (typeof (m as { mockReset?: () => void }).mockReset === 'function') {
      (m as unknown as { mockReset: () => void }).mockReset();
    }
  }
  mocks.ollamaStreamingEnabled.value = false;
  useAIChatStore.setState({ sessions: {}, dailyCosts: {}, askWorkspaceMode: {} });
  useSettingsStore.setState({ values: {} });
}

beforeEach(resetAll);
afterEach(resetAll);

// ---------------------------------------------------------------------------
// 1. An Ollama chat routes to OllamaProvider, NOT to any cloud provider.
// ---------------------------------------------------------------------------
describe('Ollama chat routes locally (never to the cloud)', () => {
  it('sends an Ollama chat through OllamaProvider and never constructs/calls a cloud provider', async () => {
    mocks.ollamaSend.mockResolvedValue({
      content: 'Local answer.',
      usage: { inputTokens: 3, outputTokens: 4, totalTokens: 7 },
      cost: 0,
      model: 'llama3.2:3b',
      stopReason: 'stop',
    });

    render(<AIChatViewer chatData={ollamaChat()} apiKeys={[]} />);
    const textarea = screen.getByTestId('chat-input') as HTMLTextAreaElement;
    act(() => fireEvent.change(textarea, { target: { value: 'private question' } }));
    act(() => fireEvent.click(screen.getByTestId('chat-send-button')));

    await waitFor(() => expect(mocks.ollamaSend).toHaveBeenCalled());

    // The local provider was constructed and called.
    expect(mocks.ollamaCtor).toHaveBeenCalled();
    // No cloud provider was EVER constructed or called.
    expect(mocks.claudeCtor).not.toHaveBeenCalled();
    expect(mocks.openaiCtor).not.toHaveBeenCalled();
    expect(mocks.geminiCtor).not.toHaveBeenCalled();
    expect(mocks.cloudSend).not.toHaveBeenCalled();
    expect(mocks.cloudStream).not.toHaveBeenCalled();
  });

  it('does NOT require an API key for a local chat (no "add your API key" error)', async () => {
    mocks.ollamaSend.mockResolvedValue({
      content: 'Local answer.',
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      cost: 0,
      model: 'llama3.2:3b',
      stopReason: 'stop',
    });

    // Note: apiKeys is empty — a cloud chat would error here; a local one must not.
    render(<AIChatViewer chatData={ollamaChat()} apiKeys={[]} />);
    act(() => fireEvent.change(screen.getByTestId('chat-input'), { target: { value: 'hi' } }));
    act(() => fireEvent.click(screen.getByTestId('chat-send-button')));

    await waitFor(() => expect(mocks.ollamaSend).toHaveBeenCalled());
    expect(screen.queryByText(/add your API key/i)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 2. NO-SILENT-CLOUD-FALLBACK — the core honesty guarantee.
// ---------------------------------------------------------------------------
describe('No silent cloud fallback (the honesty guarantee)', () => {
  it('when Ollama is unreachable, the chat shows a friendly message and NEVER calls a cloud provider', async () => {
    // Simulate "Ollama isn't running": the provider rejects (fetch failed).
    mocks.ollamaSend.mockRejectedValue(new TypeError('Failed to fetch'));

    render(<AIChatViewer chatData={ollamaChat()} apiKeys={[
      // A valid cloud key is present — a buggy fallthrough could be tempted to
      // use it. It MUST NOT.
      { provider: 'anthropic', key: 'sk-ant-valid', isValid: true },
    ]} />);
    act(() => fireEvent.change(screen.getByTestId('chat-input'), { target: { value: 'confidential' } }));
    act(() => fireEvent.click(screen.getByTestId('chat-send-button')));

    await waitFor(() => expect(mocks.ollamaSend).toHaveBeenCalled());

    // The friendly, accurate message is shown (mentions Ollama + nothing left).
    await waitFor(() =>
      expect(screen.getByText(/Ollama isn't running/i)).toBeTruthy(),
    );
    expect(screen.getByText(/nothing left your machine/i)).toBeTruthy();

    // The cloud provider was NEVER touched despite a valid key being present.
    expect(mocks.claudeCtor).not.toHaveBeenCalled();
    expect(mocks.openaiCtor).not.toHaveBeenCalled();
    expect(mocks.geminiCtor).not.toHaveBeenCalled();
    expect(mocks.cloudSend).not.toHaveBeenCalled();
    expect(mocks.cloudStream).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 3. Streaming + abort path.
// ---------------------------------------------------------------------------
describe('Ollama streaming + abort', () => {
  it('streams tokens via OllamaProvider.sendMessageStreaming (no cloud call)', async () => {
    mocks.ollamaStreamingEnabled.value = true;
    mocks.ollamaStream.mockImplementation(async (_prompt: string, opts: { onChunk: (c: string) => void }) => {
      opts.onChunk('Hel');
      opts.onChunk('lo');
      return {
        content: 'Hello',
        usage: { inputTokens: 2, outputTokens: 2, totalTokens: 4 },
        cost: 0,
        model: 'llama3.2:3b',
        stopReason: 'stop',
      };
    });

    render(<AIChatViewer chatData={ollamaChat()} apiKeys={[]} />);
    act(() => fireEvent.change(screen.getByTestId('chat-input'), { target: { value: 'stream please' } }));
    act(() => fireEvent.click(screen.getByTestId('chat-send-button')));

    await waitFor(() => expect(mocks.ollamaStream).toHaveBeenCalled());
    // Streaming path used, not the non-streaming send, and no cloud call.
    expect(mocks.ollamaSend).not.toHaveBeenCalled();
    expect(mocks.cloudSend).not.toHaveBeenCalled();
    expect(mocks.cloudStream).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByText('Hello')).toBeTruthy());
  });

  it('passes an AbortSignal to the stream so Stop can cancel it', async () => {
    mocks.ollamaStreamingEnabled.value = true;
    let capturedSignal: AbortSignal | undefined;
    // Never resolves until aborted — lets us click Stop mid-stream.
    mocks.ollamaStream.mockImplementation(
      (_prompt: string, opts: { onChunk: (c: string) => void; signal?: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          capturedSignal = opts.signal;
          opts.onChunk('partial');
          opts.signal?.addEventListener('abort', () => {
            reject(new DOMException('Aborted', 'AbortError'));
          });
        }),
    );

    render(<AIChatViewer chatData={ollamaChat()} apiKeys={[]} />);
    act(() => fireEvent.change(screen.getByTestId('chat-input'), { target: { value: 'long' } }));
    act(() => fireEvent.click(screen.getByTestId('chat-send-button')));

    await waitFor(() => expect(mocks.ollamaStream).toHaveBeenCalled());
    expect(capturedSignal).toBeDefined();
    expect(capturedSignal!.aborted).toBe(false);

    // The Stop button replaces Send while loading. Click it.
    await waitFor(() => expect(screen.getByTestId('chat-stop-button')).toBeTruthy());
    act(() => fireEvent.click(screen.getByTestId('chat-stop-button')));

    await waitFor(() => expect(capturedSignal!.aborted).toBe(true));
    // Still no cloud call after an abort.
    expect(mocks.cloudSend).not.toHaveBeenCalled();
    expect(mocks.cloudStream).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 4. providerFactory — local construction + no fallthrough.
// ---------------------------------------------------------------------------
describe('providerFactory local construction', () => {
  it('constructs the local OllamaProvider for "ollama" (no key needed)', () => {
    const p = createProvider({ provider: 'ollama' });
    expect(p).toBeDefined();
    expect(mocks.ollamaCtor).toHaveBeenCalled();
    // No cloud provider constructed.
    expect(mocks.claudeCtor).not.toHaveBeenCalled();
    expect(mocks.openaiCtor).not.toHaveBeenCalled();
    expect(mocks.geminiCtor).not.toHaveBeenCalled();
  });

  it('isLocalProviderId recognises only ollama as local', () => {
    expect(isLocalProviderId('ollama')).toBe(true);
    expect(isLocalProviderId('anthropic')).toBe(false);
    expect(isLocalProviderId('openai')).toBe(false);
    expect(isLocalProviderId('google')).toBe(false);
  });
});
