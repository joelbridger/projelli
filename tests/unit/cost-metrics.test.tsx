/**
 * Q4 (Wave 1.2) — CostMetrics dashboard component tests.
 *
 * Verifies rendering logic + pure helpers:
 *   - Total cost for the current month matches the fixture
 *   - Per-provider breakdown shows the right amounts and labels
 *   - Bars render for each day that has data; zero days render baseline ticks
 *   - Entries without cost metadata are silently skipped (retroactive behavior)
 *   - buildDailySeries returns exactly 30 buckets; oldest → newest
 */

import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import type { AuditEntry } from '@/platform/types/audit';
import {
  CostMetrics,
  buildDailySeries,
  computeMonthTotals,
} from '@/platform/analysis/ui/CostMetrics';

function makeEntry(partial: Partial<AuditEntry> & { timestamp: string }): AuditEntry {
  return {
    id: `audit_${Math.random().toString(36).slice(2, 10)}`,
    action: 'model_call',
    description: 'test',
    model: undefined,
    inputs: {},
    outputs: {},
    userDecision: undefined,
    metadata: {},
    ...partial,
  };
}

describe('CostMetrics — pure helpers', () => {
  it('buildDailySeries produces 30 buckets ending today', () => {
    const now = new Date(2026, 3, 16, 12, 0, 0); // Apr 16 2026
    const series = buildDailySeries([], now);
    expect(series).toHaveLength(30);
    expect(series[series.length - 1]?.date).toBe('2026-04-16');
    // 30 days back from 04-16 = 03-18.
    expect(series[0]?.date).toBe('2026-03-18');
  });

  it('buildDailySeries folds entries into the correct bucket by local date', () => {
    const now = new Date(2026, 3, 16, 12, 0, 0);
    const entries = [
      makeEntry({
        timestamp: new Date(2026, 3, 16, 9, 0, 0).toISOString(),
        costUsd: 0.05,
        provider: 'anthropic',
      }),
      makeEntry({
        timestamp: new Date(2026, 3, 15, 23, 0, 0).toISOString(),
        costUsd: 0.02,
        provider: 'openai',
      }),
      makeEntry({
        timestamp: new Date(2026, 3, 16, 20, 0, 0).toISOString(),
        costUsd: 0.03,
        provider: 'openai',
      }),
    ];
    const series = buildDailySeries(entries, now);
    const today = series.find((d) => d.date === '2026-04-16')!;
    const yesterday = series.find((d) => d.date === '2026-04-15')!;
    expect(today.total).toBeCloseTo(0.08, 10);
    expect(today.byProvider['anthropic']).toBeCloseTo(0.05, 10);
    expect(today.byProvider['openai']).toBeCloseTo(0.03, 10);
    expect(yesterday.total).toBeCloseTo(0.02, 10);
    expect(yesterday.byProvider['openai']).toBeCloseTo(0.02, 10);
  });

  it('buildDailySeries ignores entries without cost data', () => {
    const now = new Date(2026, 3, 16, 12, 0, 0);
    const entries = [
      makeEntry({ timestamp: new Date(2026, 3, 16, 9, 0, 0).toISOString() }),
      makeEntry({
        timestamp: new Date(2026, 3, 16, 10, 0, 0).toISOString(),
        costUsd: 0.01,
        provider: 'anthropic',
      }),
    ];
    const series = buildDailySeries(entries, now);
    const today = series.find((d) => d.date === '2026-04-16')!;
    expect(today.total).toBeCloseTo(0.01, 10);
    expect(today.count).toBe(1);
  });

  it('buildDailySeries reads legacy cost from outputs.cost', () => {
    const now = new Date(2026, 3, 16, 12, 0, 0);
    const entry = makeEntry({
      timestamp: new Date(2026, 3, 16, 9, 0, 0).toISOString(),
      outputs: { cost: 0.04 },
      metadata: { provider: 'google' },
    });
    const series = buildDailySeries([entry], now);
    const today = series.find((d) => d.date === '2026-04-16')!;
    expect(today.total).toBeCloseTo(0.04, 10);
    expect(today.byProvider['google']).toBeCloseTo(0.04, 10);
  });

  it('buildDailySeries infers provider from model name when not specified', () => {
    const now = new Date(2026, 3, 16, 12, 0, 0);
    const entry = makeEntry({
      timestamp: new Date(2026, 3, 16, 9, 0, 0).toISOString(),
      model: 'claude-sonnet-4-6',
      costUsd: 0.07,
    });
    const series = buildDailySeries([entry], now);
    const today = series.find((d) => d.date === '2026-04-16')!;
    expect(today.byProvider['anthropic']).toBeCloseTo(0.07, 10);
  });

  it('computeMonthTotals only sums the current calendar month', () => {
    const now = new Date(2026, 3, 16, 12, 0, 0); // April 2026
    const entries = [
      makeEntry({
        timestamp: new Date(2026, 3, 2, 9, 0, 0).toISOString(),
        costUsd: 0.1,
        provider: 'anthropic',
      }),
      makeEntry({
        // Previous month — should NOT count.
        timestamp: new Date(2026, 2, 31, 9, 0, 0).toISOString(),
        costUsd: 999,
        provider: 'anthropic',
      }),
      makeEntry({
        timestamp: new Date(2026, 3, 16, 10, 0, 0).toISOString(),
        costUsd: 0.2,
        provider: 'openai',
      }),
    ];
    const totals = computeMonthTotals(entries, now);
    expect(totals.total).toBeCloseTo(0.3, 10);
    expect(totals.count).toBe(2);
    expect(totals.byProvider['anthropic']).toBeCloseTo(0.1, 10);
    expect(totals.byProvider['openai']).toBeCloseTo(0.2, 10);
  });
});

describe('CostMetrics — rendering', () => {
  it('renders the chart and total with a correct fixture', () => {
    const now = new Date(2026, 3, 16, 12, 0, 0);
    const entries = [
      makeEntry({
        timestamp: new Date(2026, 3, 2, 9, 0, 0).toISOString(),
        costUsd: 0.1,
        provider: 'anthropic',
      }),
      makeEntry({
        timestamp: new Date(2026, 3, 16, 10, 0, 0).toISOString(),
        costUsd: 0.25,
        provider: 'openai',
      }),
      makeEntry({
        timestamp: new Date(2026, 3, 16, 11, 0, 0).toISOString(),
        costUsd: 0.05,
        provider: 'google',
      }),
    ];
    render(<CostMetrics entries={entries} now={now} />);

    // Total line shows the sum.
    const total = screen.getByTestId('cost-metrics-total-amount');
    expect(total.textContent).toBe('$0.40');

    // Chart is present.
    expect(screen.getByTestId('cost-metrics-chart')).toBeInTheDocument();

    // Breakdown rows for each provider.
    const breakdown = screen.getByTestId('cost-metrics-breakdown');
    const claude = within(breakdown).getByTestId('cost-metrics-provider-anthropic');
    expect(claude.textContent).toMatch(/Claude/);
    expect(claude.textContent).toMatch(/\$0\.10/);
    const openai = within(breakdown).getByTestId('cost-metrics-provider-openai');
    expect(openai.textContent).toMatch(/OpenAI/);
    expect(openai.textContent).toMatch(/\$0\.25/);
    const gemini = within(breakdown).getByTestId('cost-metrics-provider-google');
    expect(gemini.textContent).toMatch(/Gemini/);
    expect(gemini.textContent).toMatch(/\$0\.05/);

    // A bar is rendered for each day that has data.
    expect(screen.getByTestId('cost-metrics-bar-2026-04-02-anthropic')).toBeInTheDocument();
    expect(screen.getByTestId('cost-metrics-bar-2026-04-16-openai')).toBeInTheDocument();
    expect(screen.getByTestId('cost-metrics-bar-2026-04-16-google')).toBeInTheDocument();
  });

  it('shows zero-state copy when no entries carry cost data', () => {
    const now = new Date(2026, 3, 16, 12, 0, 0);
    const retroOnly = [
      makeEntry({ timestamp: new Date(2026, 3, 10, 9, 0, 0).toISOString() }),
    ];
    render(<CostMetrics entries={retroOnly} now={now} />);
    const total = screen.getByTestId('cost-metrics-total-amount');
    expect(total.textContent).toBe('$0.00');
    const breakdown = screen.getByTestId('cost-metrics-breakdown');
    expect(breakdown.textContent).toMatch(/No recorded costs/i);
  });

  it('renders with zero entries without crashing', () => {
    const now = new Date(2026, 3, 16, 12, 0, 0);
    render(<CostMetrics entries={[]} now={now} />);
    expect(screen.getByTestId('cost-metrics-chart')).toBeInTheDocument();
    expect(screen.getByTestId('cost-metrics-total-amount').textContent).toBe('$0.00');
  });
});
