import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { OnboardingKpiStrip } from '../OnboardingKpiStrip';

describe('OnboardingKpiStrip', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders the three local onboarding stats without making a network call', () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    render(
      <OnboardingKpiStrip
        kpis={{
          avgDaysToComplete: 3.5,
          stalledCount: 2,
          completionRate: 0.67,
          completedCount: 2,
          activeCount: 1,
        }}
      />,
    );

    expect(screen.getByText('Avg days to complete')).toBeTruthy();
    expect(screen.getByText('Stalled')).toBeTruthy();
    expect(screen.getByText('Completion rate')).toBeTruthy();
    expect(screen.getByText('3.5 days')).toBeTruthy();
    expect(screen.getByText('2')).toBeTruthy();
    expect(screen.getByText('67%')).toBeTruthy();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('explains when no onboarding has been completed yet', () => {
    render(
      <OnboardingKpiStrip
        kpis={{
          avgDaysToComplete: null,
          stalledCount: 0,
          completionRate: 0,
          completedCount: 0,
          activeCount: 2,
        }}
      />,
    );

    expect(screen.getByText('No completed onboardings yet')).toBeTruthy();
  });
});
