/**
 * Q3 (Wave 1.2) — Chat cost aggregation store.
 *
 * Covers:
 *  - per-chat cost + token totals accumulate across multiple responses
 *  - per-day total across ALL chats accumulates into the same bucket
 *  - provider breakdown for "today" is kept correctly
 *  - bucket is keyed by local YYYY-MM-DD (frozen via fake timers)
 *  - bucket older than retention window is pruned
 *  - selectors `useChatCost` / `useTodayCost` via `getState()` reflect latest
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useAIChatStore, todayKey } from '@/stores/aiChatStore';

function resetStore() {
  useAIChatStore.setState({ sessions: {}, dailyCosts: {} });
}

describe('aiChatStore — cost aggregation (Q3)', () => {
  beforeEach(() => {
    // jsdom gives us localStorage. Clear it so the persist middleware
    // starts from a clean slate each test.
    localStorage.clear();
    resetStore();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('accumulates cost and tokens per chat', () => {
    const { recordCost } = useAIChatStore.getState();
    recordCost('chat-a', { cost: 0.02, inputTokens: 100, outputTokens: 50, provider: 'anthropic' });
    recordCost('chat-a', { cost: 0.04, inputTokens: 200, outputTokens: 80, provider: 'anthropic' });

    const session = useAIChatStore.getState().sessions['chat-a'];
    expect(session?.cost).toBeCloseTo(0.06, 10);
    expect(session?.inputTokens).toBe(300);
    expect(session?.outputTokens).toBe(130);
  });

  it('keeps per-chat totals separate across chats', () => {
    const { recordCost } = useAIChatStore.getState();
    recordCost('chat-a', { cost: 0.02, inputTokens: 100, outputTokens: 50, provider: 'anthropic' });
    recordCost('chat-b', { cost: 0.05, inputTokens: 150, outputTokens: 70, provider: 'openai' });

    const state = useAIChatStore.getState();
    expect(state.sessions['chat-a']?.cost).toBeCloseTo(0.02, 10);
    expect(state.sessions['chat-b']?.cost).toBeCloseTo(0.05, 10);
  });

  it('aggregates today total across all chats and providers', () => {
    const { recordCost } = useAIChatStore.getState();
    recordCost('chat-a', { cost: 0.02, inputTokens: 100, outputTokens: 50, provider: 'anthropic' });
    recordCost('chat-b', { cost: 0.05, inputTokens: 150, outputTokens: 70, provider: 'openai' });
    recordCost('chat-c', { cost: 0.01, inputTokens: 80, outputTokens: 40, provider: 'google' });

    const today = useAIChatStore.getState().dailyCosts[todayKey()];
    expect(today).toBeDefined();
    expect(today!.total).toBeCloseTo(0.08, 10);
    expect(today!.inputTokens).toBe(330);
    expect(today!.outputTokens).toBe(160);
    expect(today!.byProvider['anthropic']).toBeCloseTo(0.02, 10);
    expect(today!.byProvider['openai']).toBeCloseTo(0.05, 10);
    expect(today!.byProvider['google']).toBeCloseTo(0.01, 10);
  });

  it('treats zero-cost entries as valid contributions (does not break tokens)', () => {
    const { recordCost } = useAIChatStore.getState();
    recordCost('chat-a', { cost: 0, inputTokens: 42, outputTokens: 0, provider: 'ollama' });

    const session = useAIChatStore.getState().sessions['chat-a'];
    expect(session?.cost).toBe(0);
    expect(session?.inputTokens).toBe(42);

    const today = useAIChatStore.getState().dailyCosts[todayKey()];
    expect(today?.total).toBe(0);
    expect(today?.inputTokens).toBe(42);
    // Ollama provider should be tracked even though cost is 0.
    expect(today?.byProvider['ollama']).toBe(0);
  });

  it('uses an unknown bucket when provider is omitted', () => {
    const { recordCost } = useAIChatStore.getState();
    recordCost('chat-a', { cost: 0.01, inputTokens: 10, outputTokens: 5 });
    const today = useAIChatStore.getState().dailyCosts[todayKey()];
    expect(today?.byProvider['unknown']).toBeCloseTo(0.01, 10);
  });

  it('creates a fresh bucket after the local date rolls over', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-16T10:00:00'));

    const { recordCost } = useAIChatStore.getState();
    recordCost('chat-a', { cost: 0.03, inputTokens: 100, outputTokens: 50, provider: 'anthropic' });
    expect(useAIChatStore.getState().dailyCosts['2026-04-16']?.total).toBeCloseTo(0.03, 10);

    // Roll forward one day.
    vi.setSystemTime(new Date('2026-04-17T09:00:00'));
    recordCost('chat-a', { cost: 0.05, inputTokens: 200, outputTokens: 60, provider: 'anthropic' });

    const state = useAIChatStore.getState();
    // Old bucket still present (within retention window).
    expect(state.dailyCosts['2026-04-16']?.total).toBeCloseTo(0.03, 10);
    // New bucket created for the new day.
    expect(state.dailyCosts['2026-04-17']?.total).toBeCloseTo(0.05, 10);
  });

  it('prunes buckets older than 31 days', () => {
    // Retention was extended from 7 to 31 days (F1 — Workstream F Phase 1)
    // so that month and week summaries can be served from the store directly.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-01T10:00:00'));
    const { recordCost } = useAIChatStore.getState();
    recordCost('chat-a', { cost: 0.01, inputTokens: 10, outputTokens: 5, provider: 'anthropic' });
    expect(useAIChatStore.getState().dailyCosts['2026-04-01']?.total).toBeCloseTo(0.01, 10);

    // Advance 33 days; the 04-01 bucket should now be pruned on the next write.
    vi.setSystemTime(new Date('2026-05-04T10:00:00'));
    recordCost('chat-a', { cost: 0.02, inputTokens: 20, outputTokens: 10, provider: 'anthropic' });

    const state = useAIChatStore.getState();
    expect(state.dailyCosts['2026-04-01']).toBeUndefined();
    expect(state.dailyCosts['2026-05-04']?.total).toBeCloseTo(0.02, 10);
  });

  it('creates a session on the fly if cost arrives before initSession', () => {
    const { recordCost } = useAIChatStore.getState();
    recordCost('orphan-chat', { cost: 0.02, inputTokens: 10, outputTokens: 5, provider: 'openai' });

    const session = useAIChatStore.getState().sessions['orphan-chat'];
    expect(session).toBeDefined();
    expect(session?.cost).toBeCloseTo(0.02, 10);
    expect(session?.messages).toEqual([]);
  });
});

describe('aiChatStore — todayKey', () => {
  afterEach(() => vi.useRealTimers());

  it('formats as YYYY-MM-DD with zero padding', () => {
    const key = todayKey(new Date(2026, 0, 5, 12, 0, 0)); // Jan 5 2026 local
    expect(key).toBe('2026-01-05');
  });

  it('respects local time not UTC', () => {
    // Freeze "now" to 11:30 PM local on 2026-04-16. UTC would roll us
    // into 2026-04-17 depending on TZ; the key should still be 04-16 in
    // local time.
    const localDate = new Date(2026, 3, 16, 23, 30, 0);
    expect(todayKey(localDate)).toBe('2026-04-16');
  });
});
