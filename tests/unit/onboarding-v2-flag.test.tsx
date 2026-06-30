/**
 * FirstRunOverlay — flag gating.
 *
 * Verifies the onboardingV2 flag picks the right first-run implementation:
 * OFF (default) keeps today's GuidedOnboarding; ON renders OnboardingV2.
 * Both components are stubbed so the test isolates the branch logic.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@/features/onboarding/GuidedOnboarding', () => ({
  GuidedOnboarding: () => <div data-testid="guided-stub" />,
}));
vi.mock('@/features/onboarding/v2/OnboardingV2', () => ({
  OnboardingV2: () => <div data-testid="v2-stub" />,
}));

import { FirstRunOverlay } from '@/features/onboarding/FirstRunOverlay';

const noop = () => {};
const props = { onSaveKey: noop, onComplete: noop };

describe('FirstRunOverlay flag gating', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('renders GuidedOnboarding when the flag is OFF (default)', () => {
    render(<FirstRunOverlay {...props} />);
    expect(screen.getByTestId('guided-stub')).toBeTruthy();
    expect(screen.queryByTestId('v2-stub')).toBeNull();
  });

  it('renders OnboardingV2 when the flag is ON via localStorage', () => {
    localStorage.setItem('lantern:onboardingV2', '1');
    render(<FirstRunOverlay {...props} />);
    expect(screen.getByTestId('v2-stub')).toBeTruthy();
    expect(screen.queryByTestId('guided-stub')).toBeNull();
  });
});
