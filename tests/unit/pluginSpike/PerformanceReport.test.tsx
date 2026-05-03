// Plugin Spike — performance report stats + rendering.

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

import { PerformanceReport } from '@/components/pluginSpike/PerformanceReport';

describe('PerformanceReport', () => {
  it('renders an empty-state message when no durations are passed', () => {
    render(<PerformanceReport durations={[]} />);
    expect(screen.getByTestId('perf-report-empty')).toBeInTheDocument();
  });

  it('renders stats labels (median, p95, max, etc.) when durations are passed', () => {
    const durations = [5, 10, 15, 20, 25, 30, 35, 40, 45, 50];
    render(<PerformanceReport durations={durations} />);
    const node = screen.getByTestId('perf-report');
    expect(node.textContent).toContain('Median');
    expect(node.textContent).toContain('p95');
    expect(node.textContent).toContain('Max');
    expect(node.textContent).toContain('Min');
    expect(node.textContent).toContain('Mean');
    expect(node.textContent).toContain('Count');
  });

  it('marks pass when median is below the threshold', () => {
    const durations = [5, 5, 5, 5, 5];
    render(<PerformanceReport durations={durations} thresholdMs={50} />);
    expect(screen.getByTestId('perf-report').textContent).toContain('(pass)');
  });

  it('marks fail when median exceeds the threshold', () => {
    const durations = [200, 200, 200, 200, 200];
    render(<PerformanceReport durations={durations} thresholdMs={50} />);
    expect(screen.getByTestId('perf-report').textContent).toContain('(fail)');
  });

  it('renders a single bar bucket when all values are identical', () => {
    // Edge case: zero range. The histogram should still render without
    // crashing or producing NaN heights.
    const { container } = render(<PerformanceReport durations={[10, 10, 10]} />);
    expect(container.querySelectorAll('div[style*="height"]').length).toBeGreaterThan(0);
  });
});
