/**
 * FirstRunOverlay — always renders the live 4-step OnboardingV2 flow.
 *
 * The old `onboardingV2` flag (and the 9-step GuidedOnboarding it used to
 * gate) was retired 2026-06-30; OnboardingV2 is now the only first-run
 * surface. This pins that FirstRunOverlay is a pure pass-through.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@/features/onboarding/v2/OnboardingV2', () => ({
  OnboardingV2: () => <div data-testid="v2-stub" />,
}));

import { FirstRunOverlay } from '@/features/onboarding/FirstRunOverlay';

const noop = () => {};
const props = { onSaveKey: noop, onComplete: noop };

describe('FirstRunOverlay', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('renders OnboardingV2 unconditionally', () => {
    render(<FirstRunOverlay {...props} />);
    expect(screen.getByTestId('v2-stub')).toBeTruthy();
  });

  it('renders OnboardingV2 even if a stale onboardingV2 localStorage flag is present', () => {
    localStorage.setItem('lantern:onboardingV2', '0');
    render(<FirstRunOverlay {...props} />);
    expect(screen.getByTestId('v2-stub')).toBeTruthy();
  });
});
