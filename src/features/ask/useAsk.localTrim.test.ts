/**
 * Local-AI context trimming — end-to-end through `useAsk.handleAsk` (step-4
 * adversarial review, finding 6). The embedded on-device model runs with a
 * small, fixed context window; Ask must trim retrieved chunks + history to
 * fit it before sending, and must NOT touch cloud sends at all.
 */
import '@/i18n';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import type { RagHit } from '@/platform/utils/tauri-commands';
import { SK_ASK_FILES_ONLY } from '@/config/identity';

const { retrieveMock, isMemoryEnabledMock, buildResolvedAskProviderMock } = vi.hoisted(() => ({
  retrieveMock: vi.fn(),
  isMemoryEnabledMock: vi.fn(() => true),
  buildResolvedAskProviderMock: vi.fn(),
}));

vi.mock('@/platform/rag/MemoryService', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/platform/rag/MemoryService')>();
  return {
    ...original,
    isMemoryEnabled: (): boolean => isMemoryEnabledMock(),
    MemoryService: {
      ...original.MemoryService,
      retrieve: (...args: unknown[]): unknown => retrieveMock(...args),
    },
  };
});

vi.mock('./askHelpers', async (importOriginal) => {
  const original = await importOriginal<typeof import('./askHelpers')>();
  return {
    ...original,
    buildResolvedAskProvider: (): unknown => buildResolvedAskProviderMock(),
  };
});

import { useAsk } from './useAsk';
import { useAIChatStore } from '@/platform/state/aiChatStore';
import { LOCAL_CONTEXT_TOO_LONG_MESSAGE } from './localContextTrim';

/** No active matter + no workspace root (the default in this test env) derives
 *  the 'ask-global' chatId (see askChatId in useAsk.ts). */
const TEST_CHAT_ID = 'ask-global';

/** A single big chunk of text, large enough that a handful of them blow past
 *  a small test context window but a single one does not. */
const BIG_CHUNK = 'lorem ipsum dolor sit amet '.repeat(150); // ~4000 chars

function makeHits(n: number): RagHit[] {
  return Array.from({ length: n }, (_, i) => ({
    path: `Clients/Test/doc-${String(i)}.md`,
    chunkText: `${BIG_CHUNK} [chunk ${String(i)}]`,
    score: 1 - i * 0.1, // hit 0 is highest relevance, descending after
    paragraphIndex: i,
  }));
}

function makeFakeProvider(opts: {
  providerId: string;
  maxContextTokens?: number;
  answer?: string;
}) {
  const sendMessage = vi.fn().mockResolvedValue({
    content: opts.answer ?? 'Here is the answer.',
    usage: { inputTokens: 10, outputTokens: 10, totalTokens: 20 },
    cost: 0,
    latency: 1,
    model: 'test-model',
    stopReason: 'stop',
  });
  return {
    isConfigured: () => true,
    sendMessage,
    getMetadata: () => ({
      model: 'test-model',
      capabilities: { maxContextTokens: opts.maxContextTokens },
    }),
  };
}

beforeEach(() => {
  retrieveMock.mockReset();
  isMemoryEnabledMock.mockReset().mockReturnValue(true);
  buildResolvedAskProviderMock.mockReset();
  useAIChatStore.getState().clearAllSessions();
  // Smart mode (default) so the model is always called (no no-evidence
  // dead-end) — files-only isn't needed here since retrieval always finds hits.
  localStorage.setItem(SK_ASK_FILES_ONLY, '0');
  // Grant file-access consent so a CLOUD provider's retrieved context isn't
  // dropped by the (unrelated) consent gate — irrelevant for local sends,
  // which never gate on consent, but needed for the cloud-bypass test below.
  useAIChatStore.getState().setFileAccessConsent(TEST_CHAT_ID, {
    state: 'granted',
    grantedScope: { kind: 'allMatters' },
  });
});

describe('useAsk — local-AI context trimming', () => {
  it('trims low-relevance chunks before sending to the local provider, and cites only what was sent', async () => {
    const hits = makeHits(6); // way over this test's window if all sent
    retrieveMock.mockResolvedValue(hits);
    // Sized (see the module comment for the ~4-char/token estimate) so the top
    // 3 of 6 chunks fit but not all 6 — a genuine partial trim, not a
    // collapse-to-one.
    const fakeProvider = makeFakeProvider({ providerId: 'lantern-local', maxContextTokens: 5000 });
    buildResolvedAskProviderMock.mockResolvedValue({
      provider: fakeProvider,
      providerId: 'lantern-local',
      model: 'qwen3-4b-instruct-2507',
    });

    // Ask requires a durable-audit sink to send (fail-closed audit door):
    // production always wires one; a send with none is refused by design.
    const { result } = renderHook(() => useAsk({ onAuditLog: () => undefined }));

    act(() => {
      // eslint-disable-next-line lantern-async/no-silent-failure -- handleAsk has its own try/catch and never rejects
      void result.current.handleAsk('what does the highest relevance doc say?');
    });

    await waitFor(() => {
      expect(result.current.status).toBe('done');
    });

    expect(fakeProvider.sendMessage).toHaveBeenCalledTimes(1);
    const [, sendOptions] = fakeProvider.sendMessage.mock.calls[0] as [string, { systemPrompt: string }];
    // The 3 highest-relevance chunks survived; the 3 lowest-relevance were dropped.
    expect(sendOptions.systemPrompt).toContain('doc-0.md');
    expect(sendOptions.systemPrompt).toContain('doc-1.md');
    expect(sendOptions.systemPrompt).toContain('doc-2.md');
    expect(sendOptions.systemPrompt).not.toContain('doc-3.md');
    expect(sendOptions.systemPrompt).not.toContain('doc-4.md');
    expect(sendOptions.systemPrompt).not.toContain('doc-5.md');
  });

  it('files-only mode: declines honestly instead of sending when even the question + top chunk cannot fit', async () => {
    // Files-only is the mode whose whole contract is "answer only from the
    // files" — when no usable file context fits the window, it must decline,
    // never answer from nothing (round-2 F2 keeps this decline files-only).
    localStorage.setItem(SK_ASK_FILES_ONLY, '1');
    const hits = makeHits(3);
    retrieveMock.mockResolvedValue(hits);
    // Sized so even the single highest-relevance chunk plus the fixed prompt
    // overflows the window (see the module comment for the token estimate —
    // one ~4000-char chunk is ~1000 tokens; the files-only fixed prompt is
    // short, so the window must be small enough that chunk + fixed busts it).
    const fakeProvider = makeFakeProvider({ providerId: 'lantern-local', maxContextTokens: 1200 });
    buildResolvedAskProviderMock.mockResolvedValue({
      provider: fakeProvider,
      providerId: 'lantern-local',
      model: 'qwen3-4b-instruct-2507',
    });

    // Ask requires a durable-audit sink to send (fail-closed audit door):
    // production always wires one; a send with none is refused by design.
    const { result } = renderHook(() => useAsk({ onAuditLog: () => undefined }));

    act(() => {
      // eslint-disable-next-line lantern-async/no-silent-failure -- handleAsk has its own try/catch and never rejects
      void result.current.handleAsk('a question');
    });

    await waitFor(() => {
      expect(result.current.status).toBe('done');
    });

    expect(fakeProvider.sendMessage).not.toHaveBeenCalled();
    expect(result.current.turns).toHaveLength(1);
    expect(result.current.turns[0]?.answer).toBe(LOCAL_CONTEXT_TOO_LONG_MESSAGE);
  });

  it('smart mode: a follow-up whose sole retrieved chunk cannot fit still answers from history (round-2 F2)', async () => {
    // Turn 1: a normal ask that fits, so the conversation has history.
    retrieveMock.mockResolvedValue(makeHits(1));
    const fakeProvider = makeFakeProvider({
      providerId: 'lantern-local',
      maxContextTokens: 5000,
      answer: 'The rebalance is scheduled for Q3.',
    });
    buildResolvedAskProviderMock.mockResolvedValue({
      provider: fakeProvider,
      providerId: 'lantern-local',
      model: 'qwen3-4b-instruct-2507',
    });

    // Ask requires a durable-audit sink to send (fail-closed audit door):
    // production always wires one; a send with none is refused by design.
    const { result } = renderHook(() => useAsk({ onAuditLog: () => undefined }));

    act(() => {
      // eslint-disable-next-line lantern-async/no-silent-failure -- handleAsk has its own try/catch and never rejects
      void result.current.handleAsk('when is the rebalance?');
    });
    await waitFor(() => {
      expect(result.current.turns).toHaveLength(1);
      expect(result.current.status).toBe('done');
    });

    // Turn 2: retrieval returns ONE chunk far too big for the window. Before
    // round-2 F2 this erased all history and refused; now smart mode drops the
    // unusable chunk and answers the follow-up from history alone.
    retrieveMock.mockResolvedValue([
      {
        path: 'Clients/Test/huge.md',
        chunkText: 'x'.repeat(100_000),
        score: 0.9,
        paragraphIndex: 0,
      },
    ]);

    act(() => {
      // eslint-disable-next-line lantern-async/no-silent-failure -- handleAsk has its own try/catch and never rejects
      void result.current.handleAsk('summarize what you just said');
    });
    await waitFor(() => {
      expect(result.current.turns).toHaveLength(2);
      expect(result.current.status).toBe('done');
    });

    // The follow-up was SENT (no "too long" decline)…
    expect(fakeProvider.sendMessage).toHaveBeenCalledTimes(2);
    expect(result.current.turns[1]?.answer).not.toBe(LOCAL_CONTEXT_TOO_LONG_MESSAGE);
    const [, sendOptions] = fakeProvider.sendMessage.mock.calls[1] as [string, { systemPrompt: string }];
    // …without the oversized chunk…
    expect(sendOptions.systemPrompt).not.toContain('huge.md');
    // …but WITH the turn-1 history the answer lives in.
    expect(sendOptions.systemPrompt).toContain('The rebalance is scheduled for Q3.');
  });

  it('trims for a local Ollama route too, reading Ollama\'s own reported context budget', async () => {
    const hits = makeHits(6); // way over this test's window if all sent
    retrieveMock.mockResolvedValue(hits);
    // Same sizing as the embedded-model trim test above: the top 3 of 6 chunks
    // fit but not all 6 — a genuine partial trim, not a collapse-to-one. This
    // proves trimming reads Ollama's OWN reported maxContextTokens (round-2
    // fix, P2), not just the embedded-model path.
    const fakeProvider = makeFakeProvider({ providerId: 'ollama', maxContextTokens: 5000 });
    buildResolvedAskProviderMock.mockResolvedValue({
      provider: fakeProvider,
      providerId: 'ollama',
      model: 'llama3.2:3b',
    });

    // Ask requires a durable-audit sink to send (fail-closed audit door):
    // production always wires one; a send with none is refused by design.
    const { result } = renderHook(() => useAsk({ onAuditLog: () => undefined }));

    act(() => {
      // eslint-disable-next-line lantern-async/no-silent-failure -- handleAsk has its own try/catch and never rejects
      void result.current.handleAsk('what does the highest relevance doc say?');
    });

    await waitFor(() => {
      expect(result.current.status).toBe('done');
    });

    expect(fakeProvider.sendMessage).toHaveBeenCalledTimes(1);
    const [, sendOptions] = fakeProvider.sendMessage.mock.calls[0] as [string, { systemPrompt: string }];
    expect(sendOptions.systemPrompt).toContain('doc-0.md');
    expect(sendOptions.systemPrompt).toContain('doc-1.md');
    expect(sendOptions.systemPrompt).toContain('doc-2.md');
    expect(sendOptions.systemPrompt).not.toContain('doc-3.md');
    expect(sendOptions.systemPrompt).not.toContain('doc-4.md');
    expect(sendOptions.systemPrompt).not.toContain('doc-5.md');
  });

  it('does not trim for a cloud provider — the full retrieved context is sent untouched', async () => {
    const hits = makeHits(6);
    retrieveMock.mockResolvedValue(hits);
    const fakeProvider = makeFakeProvider({ providerId: 'anthropic' });
    buildResolvedAskProviderMock.mockResolvedValue({
      provider: fakeProvider,
      providerId: 'anthropic',
      model: 'claude-sonnet-5',
    });

    // Ask requires a durable-audit sink to send (fail-closed audit door):
    // production always wires one; a send with none is refused by design.
    const { result } = renderHook(() => useAsk({ onAuditLog: () => undefined }));

    act(() => {
      // eslint-disable-next-line lantern-async/no-silent-failure -- handleAsk has its own try/catch and never rejects
      void result.current.handleAsk('what does every doc say?');
    });

    await waitFor(() => {
      expect(result.current.status).toBe('done');
    });

    expect(fakeProvider.sendMessage).toHaveBeenCalledTimes(1);
    const [, sendOptions] = fakeProvider.sendMessage.mock.calls[0] as [string, { systemPrompt: string }];
    // Every chunk made it into the prompt — no local-only trimming path taken.
    for (let i = 0; i < 6; i++) {
      expect(sendOptions.systemPrompt).toContain(`doc-${String(i)}.md`);
    }
  });
});
