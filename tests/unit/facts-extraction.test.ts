/**
 * Fact extraction throttling + error handling (M3).
 *
 * Pure-function tests over the state machine in `factsExtraction.ts`:
 *   - extraction fires every 10 messages (not more)
 *   - 5 consecutive rejects mutes extraction for the session
 *   - provider errors from `runExtraction` resolve to `[]`, not throw
 *   - schema-mismatched responses resolve to `[]`
 */

import { describe, expect, it, vi } from 'vitest';

import {
  EXTRACTION_WINDOW,
  MAX_CONSECUTIVE_REJECTS,
  buildExtractionPrompt,
  makeInitialState,
  markAccepted,
  markCheckpointRan,
  markRejected,
  runExtraction,
  shouldRunExtraction,
} from '@/platform/rag/factsExtraction';
import type { ChatMessage } from '@/platform/types/ai';
import type { Provider, ProviderMetadata } from '@/platform/providers/Provider';

function makeProvider(
  behavior: (prompt: string) => Promise<unknown> | unknown,
): Provider {
  return {
    getMetadata: (): ProviderMetadata => ({ model: 'mock' }),
    sendMessage: async () => ({
      content: '',
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      cost: 0,
      model: 'mock',
    }),
    structuredOutput: vi.fn(async (prompt: string) => {
      const result = await behavior(prompt);
      return result as never;
    }),
    formatAttachmentForRequest: () => {
      throw new Error('not used in these tests');
    },
    supportsAttachment: () => false,
  };
}

describe('shouldRunExtraction — throttling', () => {
  it('does not fire before the first window boundary', () => {
    const state = makeInitialState();
    for (let i = 0; i < EXTRACTION_WINDOW; i++) {
      // 0..9 messages means no full window yet
      expect(shouldRunExtraction(i, state)).toBe(false);
    }
  });

  it('fires exactly at the window boundary', () => {
    const state = makeInitialState();
    expect(shouldRunExtraction(EXTRACTION_WINDOW, state)).toBe(true);
  });

  it('does not fire again until the next full window', () => {
    let state = makeInitialState();
    // Extraction ran at message 10; last checkpoint = 10
    state = markCheckpointRan(state, EXTRACTION_WINDOW);
    // Messages 11..19: still within the same window
    for (let count = 11; count < EXTRACTION_WINDOW * 2; count++) {
      expect(shouldRunExtraction(count, state)).toBe(false);
    }
    // Message 20: boundary crossed
    expect(shouldRunExtraction(EXTRACTION_WINDOW * 2, state)).toBe(true);
  });

  it('does not fire when muted for the session', () => {
    const state = { ...makeInitialState(), mutedForSession: true };
    expect(shouldRunExtraction(100, state)).toBe(false);
  });
});

describe('consecutive-reject giveup', () => {
  it('mutes after MAX_CONSECUTIVE_REJECTS rejects in a row', () => {
    let state = makeInitialState();
    for (let i = 0; i < MAX_CONSECUTIVE_REJECTS - 1; i++) {
      state = markRejected(state);
      expect(state.mutedForSession).toBe(false);
    }
    state = markRejected(state);
    expect(state.consecutiveRejects).toBe(MAX_CONSECUTIVE_REJECTS);
    expect(state.mutedForSession).toBe(true);
  });

  it('resets the reject counter on the next accept', () => {
    let state = makeInitialState();
    state = markRejected(state);
    state = markRejected(state);
    expect(state.consecutiveRejects).toBe(2);
    state = markAccepted(state);
    expect(state.consecutiveRejects).toBe(0);
  });

  it('stays muted until state is replaced (accept does not unmute)', () => {
    let state = makeInitialState();
    for (let i = 0; i < MAX_CONSECUTIVE_REJECTS; i++) {
      state = markRejected(state);
    }
    expect(state.mutedForSession).toBe(true);
    const accepted = markAccepted(state);
    // Accept only resets the streak count, not the muted flag.
    expect(accepted.mutedForSession).toBe(true);
  });
});

describe('runExtraction — error-silent-skip', () => {
  const MESSAGES: ChatMessage[] = Array.from({ length: 10 }, (_, i) => ({
    role: i % 2 === 0 ? 'user' : 'assistant',
    content: `turn ${i}`,
    timestamp: '2026-04-16T00:00:00.000Z',
  }));

  it('returns an empty array when the provider throws', async () => {
    const provider = makeProvider(() => {
      throw new Error('rate limited');
    });
    const proposals = await runExtraction(provider, MESSAGES);
    expect(proposals).toEqual([]);
  });

  it('returns an empty array when the provider returns schema-mismatched JSON', async () => {
    const provider = makeProvider(() => ({ wrong: 'shape' }));
    const proposals = await runExtraction(provider, MESSAGES);
    expect(proposals).toEqual([]);
  });

  it('returns an empty array when the provider returns null', async () => {
    const provider = makeProvider(() => null);
    const proposals = await runExtraction(provider, MESSAGES);
    expect(proposals).toEqual([]);
  });

  it('drops empty / whitespace facts from the proposal list', async () => {
    const provider = makeProvider(() => ({
      facts: [{ text: '' }, { text: '   ' }, { text: 'real fact' }],
    }));
    const proposals = await runExtraction(provider, MESSAGES);
    expect(proposals).toHaveLength(1);
    expect(proposals[0]?.text).toBe('real fact');
  });

  it('caps proposals at 3 even when the model returns more', async () => {
    const provider = makeProvider(() => ({
      facts: [
        { text: 'a' },
        { text: 'b' },
        { text: 'c' },
        { text: 'd' },
        { text: 'e' },
      ],
    }));
    const proposals = await runExtraction(provider, MESSAGES);
    expect(proposals).toHaveLength(3);
  });

  it('trims surrounding whitespace from fact text', async () => {
    const provider = makeProvider(() => ({
      facts: [{ text: '  has a dog named Scout  ' }],
    }));
    const proposals = await runExtraction(provider, MESSAGES);
    expect(proposals[0]?.text).toBe('has a dog named Scout');
  });
});

describe('buildExtractionPrompt', () => {
  it('includes the User / Assistant role markers', () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'I ship on Lantern', timestamp: 't' },
      { role: 'assistant', content: 'Got it!', timestamp: 't' },
    ];
    const prompt = buildExtractionPrompt(messages);
    expect(prompt).toContain('User: I ship on Lantern');
    expect(prompt).toContain('Assistant: Got it!');
    expect(prompt).toContain('durable');
  });
});
