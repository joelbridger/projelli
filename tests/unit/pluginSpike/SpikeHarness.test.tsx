// Plugin Spike — harness UI smoke tests.
//
// Covers the orchestration layer: Run all sequencing, [Run] per-card, scenario
// outcome propagation, and the "not yet implemented" fallback. Real bridge
// wiring is Group IV's problem; here we drive the harness with synthetic
// scenarios so we test the UI contract in isolation.

import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { useState } from 'react';

import { PluginSpikePage } from '@/components/pluginSpike/PluginSpikePage';
import { SpikeHarness } from '@/components/pluginSpike/SpikeHarness';
import type {
  HarnessState,
  ScenarioMap,
  ScenarioOutcome,
} from '@/components/pluginSpike/types';
import { SPIKE_CRITERIA, makeIdleState } from '@/components/pluginSpike/types';

function freshState(): HarnessState {
  const m: HarnessState = new Map();
  for (const c of SPIKE_CRITERIA) m.set(c.id, makeIdleState());
  return m;
}

interface WrapperProps {
  scenarios: ScenarioMap;
  onState?: (s: HarnessState) => void;
}

function Wrapper({ scenarios, onState }: WrapperProps) {
  const [state, setState] = useState<HarnessState>(freshState);
  return (
    <SpikeHarness
      state={state}
      onStateChange={(next) => {
        setState(next);
        onState?.(next);
      }}
      scenarios={scenarios}
    />
  );
}

describe('SpikeHarness', () => {
  beforeEach(() => {
    // Each test gets a fresh DOM. testing-library auto-cleans between runs.
  });

  it('renders eight criterion cards with run buttons', () => {
    render(<Wrapper scenarios={{}} />);
    for (const c of SPIKE_CRITERIA) {
      expect(screen.getByTestId(`spike-criterion-${c.id}`)).toBeInTheDocument();
      expect(screen.getByTestId(`spike-run-${c.id}`)).toBeInTheDocument();
    }
    expect(screen.getByTestId('spike-run-all')).toBeInTheDocument();
    expect(screen.getByTestId('spike-reset')).toBeInTheDocument();
  });

  it('marks a criterion pass when its handler returns pass', async () => {
    const scenarios: ScenarioMap = {
      1: async () => ({
        status: 'pass',
        details: 'document is undefined',
        metrics: { documentTypeofWasUndefined: 1 },
      }) satisfies ScenarioOutcome,
    };
    render(<Wrapper scenarios={scenarios} />);
    fireEvent.click(screen.getByTestId('spike-run-1'));
    await waitFor(() => {
      const card = screen.getByTestId('spike-criterion-1');
      expect(card.getAttribute('data-status')).toBe('pass');
    });
  });

  it('falls back to fail when no handler is wired', async () => {
    render(<Wrapper scenarios={{}} />);
    fireEvent.click(screen.getByTestId('spike-run-2'));
    await waitFor(() => {
      const card = screen.getByTestId('spike-criterion-2');
      expect(card.getAttribute('data-status')).toBe('fail');
    });
  });

  it('catches handler throws and reports them as fail with errorMessage', async () => {
    const scenarios: ScenarioMap = {
      3: async () => {
        throw new Error('boom');
      },
    };
    render(<Wrapper scenarios={scenarios} />);
    fireEvent.click(screen.getByTestId('spike-run-3'));
    await waitFor(() => {
      const card = screen.getByTestId('spike-criterion-3');
      expect(card.getAttribute('data-status')).toBe('fail');
    });
    expect(screen.getByTestId('spike-criterion-3').textContent).toContain('boom');
  });

  it('Run all cycles all 8 criteria sequentially', async () => {
    const callOrder: number[] = [];
    const scenarios: ScenarioMap = {};
    for (const c of SPIKE_CRITERIA) {
      scenarios[c.id] = async () => {
        callOrder.push(c.id);
        return { status: 'pass', details: `criterion ${c.id} ok` };
      };
    }
    render(<Wrapper scenarios={scenarios} />);
    fireEvent.click(screen.getByTestId('spike-run-all'));
    await waitFor(
      () => {
        for (const c of SPIKE_CRITERIA) {
          const card = screen.getByTestId(`spike-criterion-${c.id}`);
          expect(card.getAttribute('data-status')).toBe('pass');
        }
      },
      { timeout: 2000 },
    );
    expect(callOrder).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('Reset returns every criterion to idle', async () => {
    const scenarios: ScenarioMap = {
      1: async () => ({ status: 'pass', details: 'ok' }),
    };
    render(<Wrapper scenarios={scenarios} />);
    fireEvent.click(screen.getByTestId('spike-run-1'));
    await waitFor(() => {
      expect(screen.getByTestId('spike-criterion-1').getAttribute('data-status')).toBe('pass');
    });
    act(() => {
      fireEvent.click(screen.getByTestId('spike-reset'));
    });
    expect(screen.getByTestId('spike-criterion-1').getAttribute('data-status')).toBe('idle');
  });
});

describe('PluginSpikePage smoke', () => {
  it('renders without crashing', () => {
    render(<PluginSpikePage />);
    expect(screen.getByTestId('plugin-spike-page')).toBeInTheDocument();
    expect(screen.getByTestId('spike-harness')).toBeInTheDocument();
    expect(screen.getByTestId('spike-results-panel')).toBeInTheDocument();
  });

  it('shows criterion-4 sidebar preview empty state by default', () => {
    render(<PluginSpikePage />);
    expect(screen.getByTestId('sidebar-preview-empty')).toBeInTheDocument();
  });

  it('shows criterion-8 perf empty state by default', () => {
    render(<PluginSpikePage />);
    expect(screen.getByTestId('perf-report-empty')).toBeInTheDocument();
  });
});
