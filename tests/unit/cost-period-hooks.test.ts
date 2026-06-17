/**
 * F1 (Workstream F, Phase 1) — Unit tests for the new cost-period hooks
 * and the extended 31-day retention logic.
 *
 * Tests cover:
 *  - useThisMonthCost: sums only buckets in the current calendar month
 *  - useLast7DaysCost: sums a rolling 7-day window (inclusive of today)
 *  - keyDaysAgo: date arithmetic helper
 *  - Retention window extended to 31 days (buckets older than 31 days are pruned)
 *  - Month boundary: bucket on the last day of the previous month is excluded
 *  - Week boundary: bucket exactly 7 days ago is included; 8 days ago is excluded
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  useAIChatStore,
  todayKey,
  keyDaysAgo,
} from '@/platform/state/aiChatStore';

function resetStore() {
  useAIChatStore.setState({ sessions: {}, dailyCosts: {} });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Direct state read for useThisMonthCost logic (avoids React rendering).
 * Mirrors the selector in the hook.
 */
function getThisMonthCost(now: Date = new Date()) {
  const state = useAIChatStore.getState();
  const monthPrefix = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-`;
  let cost = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  for (const [key, bucket] of Object.entries(state.dailyCosts)) {
    if (key.startsWith(monthPrefix)) {
      cost += bucket.total;
      inputTokens += bucket.inputTokens;
      outputTokens += bucket.outputTokens;
    }
  }
  return { cost, inputTokens, outputTokens };
}

/**
 * Direct state read for useLast7DaysCost logic.
 */
function getLast7DaysCost(now: Date = new Date()) {
  const state = useAIChatStore.getState();
  const cutoff = keyDaysAgo(6, now);
  let cost = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  for (const [key, bucket] of Object.entries(state.dailyCosts)) {
    if (key >= cutoff) {
      cost += bucket.total;
      inputTokens += bucket.inputTokens;
      outputTokens += bucket.outputTokens;
    }
  }
  return { cost, inputTokens, outputTokens };
}

// ---------------------------------------------------------------------------
// keyDaysAgo
// ---------------------------------------------------------------------------

describe('keyDaysAgo', () => {
  it('returns today when daysAgo is 0', () => {
    const now = new Date(2026, 5, 4, 12, 0, 0); // 2026-06-04
    expect(keyDaysAgo(0, now)).toBe('2026-06-04');
  });

  it('returns yesterday when daysAgo is 1', () => {
    const now = new Date(2026, 5, 4, 12, 0, 0);
    expect(keyDaysAgo(1, now)).toBe('2026-06-03');
  });

  it('crosses a month boundary correctly', () => {
    const now = new Date(2026, 5, 1, 12, 0, 0); // 2026-06-01
    expect(keyDaysAgo(1, now)).toBe('2026-05-31');
  });

  it('crosses a year boundary correctly', () => {
    const now = new Date(2026, 0, 1, 12, 0, 0); // 2026-01-01
    expect(keyDaysAgo(1, now)).toBe('2025-12-31');
  });
});

// ---------------------------------------------------------------------------
// Monthly cost aggregation
// ---------------------------------------------------------------------------

describe('getThisMonthCost (mirrors useThisMonthCost selector)', () => {
  beforeEach(() => {
    localStorage.clear();
    resetStore();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('sums all buckets in the current month', () => {
    vi.setSystemTime(new Date('2026-06-04T10:00:00'));
    const { recordCost } = useAIChatStore.getState();
    // Two days in the same month.
    recordCost('c1', { cost: 0.05, inputTokens: 200, outputTokens: 100, provider: 'anthropic' });
    vi.setSystemTime(new Date('2026-06-02T10:00:00'));
    recordCost('c2', { cost: 0.03, inputTokens: 100, outputTokens: 50, provider: 'openai' });

    const result = getThisMonthCost(new Date('2026-06-04T10:00:00'));
    expect(result.cost).toBeCloseTo(0.08, 10);
    expect(result.inputTokens).toBe(300);
    expect(result.outputTokens).toBe(150);
  });

  it('excludes buckets from a previous month', () => {
    vi.setSystemTime(new Date('2026-05-31T10:00:00'));
    const { recordCost } = useAIChatStore.getState();
    recordCost('c1', { cost: 0.10, inputTokens: 500, outputTokens: 200, provider: 'anthropic' });

    vi.setSystemTime(new Date('2026-06-01T10:00:00'));
    recordCost('c2', { cost: 0.02, inputTokens: 100, outputTokens: 40, provider: 'anthropic' });

    // Query as of June 4
    const result = getThisMonthCost(new Date('2026-06-04T10:00:00'));
    // Only the June-01 bucket (0.02) should be included
    expect(result.cost).toBeCloseTo(0.02, 10);
  });

  it('returns zeros when no data exists for the month', () => {
    const result = getThisMonthCost(new Date('2026-06-04T10:00:00'));
    expect(result.cost).toBe(0);
    expect(result.inputTokens).toBe(0);
    expect(result.outputTokens).toBe(0);
  });

  it('includes all days in a multi-day month correctly', () => {
    const { recordCost } = useAIChatStore.getState();
    // Seed 3 days within June
    const days = ['2026-06-01', '2026-06-10', '2026-06-30'];
    for (const day of days) {
      vi.setSystemTime(new Date(`${day}T12:00:00`));
      recordCost(`chat-${day}`, { cost: 0.01, inputTokens: 50, outputTokens: 20, provider: 'openai' });
    }

    const result = getThisMonthCost(new Date('2026-06-30T23:00:00'));
    expect(result.cost).toBeCloseTo(0.03, 10);
  });
});

// ---------------------------------------------------------------------------
// Rolling 7-day cost aggregation
// ---------------------------------------------------------------------------

describe('getLast7DaysCost (mirrors useLast7DaysCost selector)', () => {
  beforeEach(() => {
    localStorage.clear();
    resetStore();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('sums today and the 6 preceding days (7 inclusive)', () => {
    const { recordCost } = useAIChatStore.getState();
    // Plant one cost on each of the 7 days.
    for (let i = 0; i <= 6; i++) {
      const d = new Date(2026, 5, 4 - i, 12, 0, 0); // 2026-06-04 down to 2026-05-29
      vi.setSystemTime(d);
      recordCost(`chat-${i}`, { cost: 0.01, inputTokens: 10, outputTokens: 5, provider: 'anthropic' });
    }

    const result = getLast7DaysCost(new Date('2026-06-04T23:00:00'));
    expect(result.cost).toBeCloseTo(0.07, 10);
  });

  it('excludes a bucket from 8 days ago', () => {
    const { recordCost } = useAIChatStore.getState();
    // 8 days ago
    vi.setSystemTime(new Date('2026-05-27T12:00:00'));
    recordCost('old-chat', { cost: 0.50, inputTokens: 1000, outputTokens: 500, provider: 'anthropic' });

    // Today only
    vi.setSystemTime(new Date('2026-06-04T12:00:00'));
    recordCost('today-chat', { cost: 0.02, inputTokens: 100, outputTokens: 40, provider: 'openai' });

    const result = getLast7DaysCost(new Date('2026-06-04T23:00:00'));
    // Only today's 0.02 should appear (the 0.50 is 8 days ago, outside the window)
    expect(result.cost).toBeCloseTo(0.02, 10);
  });

  it('includes a bucket exactly 6 days ago (boundary inclusive)', () => {
    const { recordCost } = useAIChatStore.getState();
    vi.setSystemTime(new Date('2026-05-29T12:00:00')); // 6 days before 2026-06-04
    recordCost('boundary-chat', { cost: 0.07, inputTokens: 200, outputTokens: 100, provider: 'anthropic' });

    const result = getLast7DaysCost(new Date('2026-06-04T23:00:00'));
    expect(result.cost).toBeCloseTo(0.07, 10);
  });

  it('returns zeros when no data exists', () => {
    const result = getLast7DaysCost(new Date('2026-06-04T10:00:00'));
    expect(result.cost).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 31-day retention window (extended from 7)
// ---------------------------------------------------------------------------

describe('pruning: 31-day retention', () => {
  beforeEach(() => {
    localStorage.clear();
    resetStore();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps a bucket that is 30 days old', () => {
    vi.setSystemTime(new Date('2026-05-05T10:00:00'));
    const { recordCost } = useAIChatStore.getState();
    recordCost('c1', { cost: 0.01, inputTokens: 10, outputTokens: 5, provider: 'anthropic' });

    // Advance 30 days and record another cost (triggers prune).
    vi.setSystemTime(new Date('2026-06-04T10:00:00'));
    recordCost('c2', { cost: 0.01, inputTokens: 10, outputTokens: 5, provider: 'anthropic' });

    // 2026-05-05 is exactly 30 days before 2026-06-04 — should still exist.
    expect(useAIChatStore.getState().dailyCosts['2026-05-05']).toBeDefined();
  });

  it('prunes a bucket that is 32 days old', () => {
    vi.setSystemTime(new Date('2026-05-03T10:00:00'));
    const { recordCost } = useAIChatStore.getState();
    recordCost('c1', { cost: 0.01, inputTokens: 10, outputTokens: 5, provider: 'anthropic' });

    // Advance 32 days and record another cost (triggers prune).
    vi.setSystemTime(new Date('2026-06-04T10:00:00'));
    recordCost('c2', { cost: 0.01, inputTokens: 10, outputTokens: 5, provider: 'anthropic' });

    // 2026-05-03 is 32 days before 2026-06-04 — should be pruned.
    expect(useAIChatStore.getState().dailyCosts['2026-05-03']).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// todayKey stability (baseline regression)
// ---------------------------------------------------------------------------

describe('todayKey baseline', () => {
  it('formats today correctly', () => {
    const key = todayKey(new Date(2026, 5, 4, 12, 0, 0)); // June 4 2026
    expect(key).toBe('2026-06-04');
  });
});
