// Plugin Spike — results panel + memo block tests.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

import {
  SpikeResultsPanel,
  buildMemoBlock,
} from '@/components/pluginSpike/SpikeResultsPanel';
import type { HarnessState } from '@/components/pluginSpike/types';
import { SPIKE_CRITERIA, makeIdleState } from '@/components/pluginSpike/types';

function freshState(): HarnessState {
  const m: HarnessState = new Map();
  for (const c of SPIKE_CRITERIA) m.set(c.id, makeIdleState());
  return m;
}

describe('buildMemoBlock', () => {
  it('produces a markdown table with a row per criterion', () => {
    const block = buildMemoBlock(freshState());
    expect(block).toContain('| # | Criterion | Result | Notes |');
    expect(block.split('\n').length).toBe(2 + SPIKE_CRITERIA.length);
    expect(block).toContain('| 1 | Worker isolation | pending');
  });

  it('reflects pass and fail in the result column', () => {
    const state = freshState();
    state.set(1, { status: 'pass', details: 'document undefined' });
    state.set(2, { status: 'fail', details: 'no result', errorMessage: 'timeout' });
    const block = buildMemoBlock(state);
    expect(block).toMatch(/\| 1 \| Worker isolation \| pass \|/);
    expect(block).toMatch(/\| 2 \| Round-trip command \| fail \|/);
    expect(block).toContain('error: timeout');
  });

  it('formats numeric metrics inline', () => {
    const state = freshState();
    state.set(8, {
      status: 'pass',
      details: 'latency ok',
      metrics: { medianMs: 12.345, p95Ms: 30.1 },
    });
    const block = buildMemoBlock(state);
    expect(block).toContain('medianMs=12.35');
    expect(block).toContain('p95Ms=30.10');
  });

  it('escapes embedded pipes in details so the table stays valid', () => {
    const state = freshState();
    state.set(3, { status: 'fail', details: 'a | b | c' });
    const block = buildMemoBlock(state);
    expect(block).toMatch(/\| 3 \| Permission denial \| fail \| a \\\| b \\\| c \|/);
  });
});

describe('SpikeResultsPanel', () => {
  beforeEach(() => {
    // navigator.clipboard is undefined in jsdom by default; install a stub
    // for tests that exercise the copy button.
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });

  it('renders all 8 criteria as result rows', () => {
    render(<SpikeResultsPanel state={freshState()} />);
    for (const c of SPIKE_CRITERIA) {
      expect(screen.getByTestId(`spike-result-${c.id}`)).toBeInTheDocument();
    }
  });

  it('shows status badges that reflect state', () => {
    const state = freshState();
    state.set(1, { status: 'pass', details: 'ok' });
    state.set(2, { status: 'fail', details: 'nope' });
    render(<SpikeResultsPanel state={state} />);
    expect(screen.getByTestId('spike-result-1').getAttribute('data-status')).toBe('pass');
    expect(screen.getByTestId('spike-result-2').getAttribute('data-status')).toBe('fail');
  });

  it('Copy memo block writes the markdown table to clipboard', async () => {
    const state = freshState();
    state.set(1, { status: 'pass', details: 'doc undefined' });
    render(<SpikeResultsPanel state={state} />);
    fireEvent.click(screen.getByTestId('spike-copy-memo'));
    await waitFor(() => {
      const writeText = (navigator.clipboard as { writeText: ReturnType<typeof vi.fn> }).writeText;
      expect(writeText).toHaveBeenCalledTimes(1);
      const arg = writeText.mock.calls[0]?.[0];
      expect(typeof arg).toBe('string');
      expect(arg).toContain('| 1 | Worker isolation | pass |');
    });
    // Button should briefly read "Copied" after success.
    await waitFor(() => {
      expect(screen.getByTestId('spike-copy-memo').textContent).toContain('Copied');
    });
  });

  it('renders the sidebar preview when criterion-4 carries a spec', () => {
    const state = freshState();
    state.set(4, {
      status: 'pass',
      details: 'panel rendered',
      sidebarSpec: { id: 'spike-panel', title: 'Spike', html: '<p>hi</p>' },
    });
    render(<SpikeResultsPanel state={state} />);
    expect(screen.getByTestId('sidebar-preview')).toBeInTheDocument();
    expect(screen.getByTestId('sidebar-preview').getAttribute('data-panel-id')).toBe('spike-panel');
  });

  it('renders the perf report when criterion-8 carries timings', () => {
    const state = freshState();
    state.set(8, {
      status: 'pass',
      details: 'latency ok',
      timings: [10, 11, 12, 13, 14, 15, 16, 17, 18, 19],
    });
    render(<SpikeResultsPanel state={state} />);
    expect(screen.getByTestId('perf-report')).toBeInTheDocument();
  });
});
