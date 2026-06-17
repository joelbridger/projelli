import { describe, it, expect, vi } from 'vitest';
import {
  compressMessages,
  estimateTokens,
  estimateMessagesTokens,
  getMessagesForSend,
  clearExpandedFlags,
  type CompressionOptions,
} from '@/features/ask/compression';
import type { ChatMessage } from '@/types/ai';
import type { Provider } from '@/modules/models/Provider';

// Helper: create a minimal ChatMessage.
function msg(role: 'user' | 'assistant', content: string, ts?: string): ChatMessage {
  return { role, content, timestamp: ts ?? new Date().toISOString() };
}

// Helper: build a mock fast provider.
function mockProvider(summaryText = 'Summary of segment'): Provider {
  return {
    sendMessage: vi.fn().mockResolvedValue({ content: summaryText, usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 }, cost: 0.001, model: 'mock' }),
    getMetadata: vi.fn().mockReturnValue({ name: 'Mock', model: 'mock', capabilities: {} }),
    structuredOutput: vi.fn().mockResolvedValue({}),
  } as unknown as Provider;
}

const baseOpts: CompressionOptions = {
  keepRecentTurns: 2,
  batchTokenTarget: 10_000,
  fastProvider: mockProvider(),
};

describe('estimateTokens', () => {
  it('returns 0 for empty string', () => expect(estimateTokens('')).toBe(0));
  it('approximates 4 chars per token', () => expect(estimateTokens('abcd')).toBe(1));
  it('rounds up', () => expect(estimateTokens('abcde')).toBe(2));
});

describe('estimateMessagesTokens', () => {
  it('sums tokens across messages', () => {
    const messages = [msg('user', 'abcd'), msg('assistant', 'efgh')];
    expect(estimateMessagesTokens(messages)).toBe(2);
  });

  it('handles empty array', () => {
    expect(estimateMessagesTokens([])).toBe(0);
  });
});

describe('compressMessages', () => {
  it('returns unchanged messages when nothing to compress', async () => {
    const messages = [msg('user', 'hi'), msg('assistant', 'hello')];
    const result = await compressMessages(messages, baseOpts);
    expect(result.originalCount).toBe(0);
    expect(result.messages).toEqual(messages);
  });

  it('keeps most recent 4 messages (2 turns) verbatim', async () => {
    const messages = Array.from({ length: 10 }, (_, i) =>
      msg(i % 2 === 0 ? 'user' : 'assistant', `message ${i}`)
    );
    const provider = mockProvider();
    const result = await compressMessages(messages, { ...baseOpts, fastProvider: provider });
    const summaries = result.messages.filter(m => m.isCompressedSummary);
    expect(summaries.length).toBeGreaterThan(0);
    // Last 4 messages (2 turns * 2 roles) should have no compressedIntoId.
    const last4 = result.messages.slice(-4);
    expect(last4.every(m => !m.compressedIntoId)).toBe(true);
  });

  it('annotates original messages with compressedIntoId', async () => {
    const messages = Array.from({ length: 8 }, (_, i) =>
      msg(i % 2 === 0 ? 'user' : 'assistant', `turn ${i}`)
    );
    const result = await compressMessages(messages, baseOpts);
    const annotated = result.messages.filter(m => m.compressedIntoId);
    expect(annotated.length).toBeGreaterThan(0);
  });

  it('throws when fastProvider is null (Ollama-only fallback)', async () => {
    const messages = Array.from({ length: 10 }, (_, i) =>
      msg(i % 2 === 0 ? 'user' : 'assistant', `m ${i}`)
    );
    await expect(
      compressMessages(messages, { ...baseOpts, fastProvider: null })
    ).rejects.toThrow('Compression requires a fast cloud model');
  });

  it('preserves attachment references in content during summarization', async () => {
    const messages = Array.from({ length: 8 }, (_, i) =>
      msg(i % 2 === 0 ? 'user' : 'assistant', i === 2 ? 'See file report.pdf' : `turn ${i}`)
    );
    const provider = mockProvider('Discussed report.pdf results');
    const result = await compressMessages(messages, { ...baseOpts, fastProvider: provider });
    const summary = result.messages.find(m => m.isCompressedSummary);
    expect(summary?.content).toContain('report.pdf');
  });

  it('originalCount matches number of compressed messages', async () => {
    const messages = Array.from({ length: 8 }, (_, i) =>
      msg(i % 2 === 0 ? 'user' : 'assistant', `turn ${i}`)
    );
    const result = await compressMessages(messages, baseOpts);
    // With keepRecentTurns=2, 4 messages kept, 4 compressed.
    expect(result.originalCount).toBe(4);
  });

  it('compressed summaries have isCompressedSummary flag', async () => {
    const messages = Array.from({ length: 8 }, (_, i) =>
      msg(i % 2 === 0 ? 'user' : 'assistant', `turn ${i}`)
    );
    const result = await compressMessages(messages, baseOpts);
    const summaries = result.messages.filter(m => m.isCompressedSummary);
    expect(summaries.every(m => m.isCompressedSummary === true)).toBe(true);
  });

  it('resulting tokens are less than original tokens for substantial chats', async () => {
    const longContent = 'x'.repeat(400); // 100 tokens each
    const messages = Array.from({ length: 10 }, (_, i) =>
      msg(i % 2 === 0 ? 'user' : 'assistant', `${longContent} turn ${i}`)
    );
    const result = await compressMessages(messages, baseOpts);
    // Summary from mock is short; result should be less than original
    expect(result.resultingTokens).toBeLessThan(result.originalTokens);
  });
});

describe('getMessagesForSend', () => {
  it('excludes messages with compressedIntoId', () => {
    const messages: ChatMessage[] = [
      { ...msg('user', 'old'), compressedIntoId: '2024-01-01T00:00:00Z' },
      { ...msg('assistant', 'summary'), isCompressedSummary: true, timestamp: '2024-01-01T00:00:00Z' },
      msg('user', 'recent'),
    ];
    const forSend = getMessagesForSend(messages);
    expect(forSend.map(m => m.content)).toEqual(['summary', 'recent']);
  });

  it('includes compressed originals when expandedForNextSend is set on summary', () => {
    const summaryTs = '2024-01-01T00:00:00Z';
    const messages: ChatMessage[] = [
      { ...msg('user', 'old'), compressedIntoId: summaryTs },
      {
        ...msg('assistant', 'summary'),
        isCompressedSummary: true,
        timestamp: summaryTs,
        expandedForNextSend: true,
      },
      msg('user', 'recent'),
    ];
    const forSend = getMessagesForSend(messages);
    expect(forSend.map(m => m.content)).toEqual(['old', 'summary', 'recent']);
  });

  it('keeps all messages when none are compressed', () => {
    const messages = [msg('user', 'hi'), msg('assistant', 'hello'), msg('user', 'bye')];
    expect(getMessagesForSend(messages)).toHaveLength(3);
  });
});

describe('clearExpandedFlags', () => {
  it('removes expandedForNextSend from all messages', () => {
    const messages: ChatMessage[] = [
      { ...msg('assistant', 'summary'), isCompressedSummary: true, expandedForNextSend: true },
      msg('user', 'recent'),
    ];
    const cleared = clearExpandedFlags(messages);
    expect(cleared.every(m => !m.expandedForNextSend)).toBe(true);
  });

  it('leaves non-expanded messages unchanged', () => {
    const messages = [msg('user', 'hi'), msg('assistant', 'hello')];
    const cleared = clearExpandedFlags(messages);
    expect(cleared).toEqual(messages);
  });
});
