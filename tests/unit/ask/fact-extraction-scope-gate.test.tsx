/**
 * A1 fail-closed + cost (review P1/P2) — when a chat's fact-client is ambiguous
 * (a mixed / all-matters / plain-turn transcript), the extraction effect must
 * bail BEFORE calling the AI provider: no wasted `runExtraction` request
 * (tokens + egress) for facts that would all be dropped anyway. When the chat
 * is a provable single client, extraction still runs.
 *
 * Uses a LOCAL (Ollama) chat so the extraction effect is reachable without the
 * cloud key / confidentiality-choice gates.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  ollamaCtor: vi.fn(),
  runExtraction: vi.fn(async () => [] as { text: string }[]),
}));

// Keep the real pure helpers (shouldRunExtraction / markCheckpointRan / …) so
// the effect's gating works; override ONLY runExtraction with a spy.
vi.mock('@/platform/rag/factsExtraction', async (orig) => {
  const real = await orig<typeof import('@/platform/rag/factsExtraction')>();
  return { ...real, runExtraction: mocks.runExtraction };
});

// Prevent any real provider construction. The local (Ollama) branch is the one
// the extraction effect builds for an ollama chat.
vi.mock('@/platform/providers/ClaudeProvider', () => ({ ClaudeProvider: class { setTools() {} sendMessage = vi.fn(); sendMessageStreaming = undefined; getMetadata() { return { model: 'c' }; } } }));
vi.mock('@/platform/providers/OpenAIProvider', () => ({ OpenAIProvider: class { setTools() {} sendMessage = vi.fn(); sendMessageStreaming = undefined; getMetadata() { return { model: 'o' }; } } }));
vi.mock('@/platform/providers/GeminiProvider', () => ({ GeminiProvider: class { setTools() {} sendMessage = vi.fn(); sendMessageStreaming = undefined; getMetadata() { return { model: 'g' }; } } }));
vi.mock('@/platform/providers/OllamaProvider', () => {
  class OllamaProvider {
    constructor(cfg: unknown) { mocks.ollamaCtor(cfg); }
    setTools() {}
    sendMessage = vi.fn();
    get sendMessageStreaming() { return undefined; }
    getMetadata() { return { providerId: 'ollama', model: 'llama3.2:3b', costPerInputToken: 0, costPerOutputToken: 0 }; }
  }
  return {
    OllamaProvider,
    OLLAMA_DEFAULT_MODEL: 'llama3.2:3b',
    OLLAMA_DEFAULT_BASE_URL: 'http://127.0.0.1:11434',
    createOllamaProvider: (cfg: unknown) => new OllamaProvider(cfg),
    detectOllama: vi.fn(async () => ({ reachable: true, models: ['llama3.2:3b'] })),
    formatOllamaDisplayName: (n: string) => n,
  };
});
vi.mock('@/features/ask/ChatCostChip', () => ({ ChatCostChip: () => null }));

import { AIChatViewer } from '@/features/ask/AIChatViewer';
import type { AIChatFile, ChatMessage, TurnScope } from '@/platform/types/ai';
import { useAIChatStore } from '@/platform/state/aiChatStore';
import { useSettingsStore } from '@/platform/settings/settingsStore';

const matter = (id: string): TurnScope => ({ kind: 'matter', matterId: id, matterName: id });

// 5 user turns (+5 assistant) = 10 messages, enough to fire shouldRunExtraction
// (EXTRACTION_WINDOW = 10) on mount. User turns carry the frozen scope.
function buildMessages(userScopes: (TurnScope | undefined)[]): ChatMessage[] {
  const out: ChatMessage[] = [];
  for (const s of userScopes) {
    out.push({ role: 'user', content: 'q', timestamp: 't', ...(s ? { scope: s } : {}) });
    out.push({ role: 'assistant', content: 'a', timestamp: 't' });
  }
  return out;
}

function ollamaChat(messages: ChatMessage[]): AIChatFile {
  return {
    id: 'fact-scope-gate-test',
    title: 'Local Chat',
    created: new Date().toISOString(),
    updated: new Date().toISOString(),
    messages,
    provider: 'ollama',
    model: 'llama3.2:3b',
  };
}

function resetAll() {
  mocks.ollamaCtor.mockReset();
  mocks.runExtraction.mockReset();
  mocks.runExtraction.mockResolvedValue([]);
  useAIChatStore.setState({ sessions: {}, dailyCosts: {}, askWorkspaceMode: {} });
  useSettingsStore.setState({ values: {} });
}

beforeEach(resetAll);
afterEach(resetAll);

describe('fact-extraction scope gate (review P1/P2)', () => {
  it('does NOT call runExtraction when the chat client is ambiguous (mixed clients)', async () => {
    const messages = buildMessages([matter('client-a'), matter('client-b'), matter('client-a'), matter('client-b'), matter('client-a')]);
    render(<AIChatViewer chatData={ollamaChat(messages)} apiKeys={[]} />);
    // Give the post-mount effect time to run and (correctly) bail.
    await waitFor(() => expect(mocks.runExtraction).not.toHaveBeenCalled());
    // Belt and suspenders: nothing extracted after a settle, and no provider built for it.
    await new Promise((r) => setTimeout(r, 0));
    expect(mocks.runExtraction).not.toHaveBeenCalled();
  });

  it('does NOT call runExtraction when a user turn is plain/unscoped (ambiguous)', async () => {
    const messages = buildMessages([matter('client-a'), undefined, matter('client-a'), matter('client-a'), matter('client-a')]);
    render(<AIChatViewer chatData={ollamaChat(messages)} apiKeys={[]} />);
    await waitFor(() => expect(mocks.runExtraction).not.toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));
    expect(mocks.runExtraction).not.toHaveBeenCalled();
  });

  it('DOES call runExtraction when every user turn is the same client (positive control)', async () => {
    const messages = buildMessages([matter('client-a'), matter('client-a'), matter('client-a'), matter('client-a'), matter('client-a')]);
    render(<AIChatViewer chatData={ollamaChat(messages)} apiKeys={[]} />);
    await waitFor(() => expect(mocks.runExtraction).toHaveBeenCalledTimes(1));
  });
});
