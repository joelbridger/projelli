/**
 * FeatureTour unit tests — exercises the 5-step popover/dialog flow plus
 * data-integrity assertions against featureTourSteps.ts.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FeatureTour } from '@/components/onboarding/FeatureTour';
import { FEATURE_TOUR_STEPS } from '@/components/onboarding/featureTourSteps';

// The tour anchors steps to real DOM elements via data-testid. Seed those
// elements (createElement/setAttribute, not innerHTML, per security hook).
function seedTargets(): () => void {
  const container = document.createElement('div');
  const targets = [
    'sidebar-tab-files',
    'sidebar-tab-ai-assistant',
    'sidebar-tab-workflows',
    'settings-gear',
  ];
  for (const testid of targets) {
    const el = document.createElement('div');
    el.setAttribute('data-testid', testid);
    el.textContent = testid;
    container.appendChild(el);
  }
  document.body.appendChild(container);
  return () => document.body.removeChild(container);
}

describe('FeatureTour', () => {
  let cleanup: (() => void) | null = null;

  beforeEach(() => {
    cleanup = seedTargets();
  });

  afterEach(() => {
    cleanup?.();
    cleanup = null;
  });

  it('renders the intro step when opened', () => {
    render(
      <FeatureTour
        open
        onClose={() => {}}
        onComplete={() => {}}
        onSkip={() => {}}
      />,
    );
    expect(screen.getAllByText("Let's take a 60-second tour").length).toBeGreaterThan(0);
  });

  it('advances to the next step on Next click', () => {
    render(
      <FeatureTour
        open
        onClose={() => {}}
        onComplete={() => {}}
        onSkip={() => {}}
      />,
    );
    fireEvent.click(screen.getByTestId('feature-tour-next'));
    expect(screen.getAllByText(FEATURE_TOUR_STEPS[1]!.title).length).toBeGreaterThan(0);
  });

  it('calls onComplete on Finish click at last step', () => {
    const onComplete = vi.fn();
    render(
      <FeatureTour
        open
        onClose={() => {}}
        onComplete={onComplete}
        onSkip={() => {}}
      />,
    );
    for (let i = 0; i < FEATURE_TOUR_STEPS.length - 1; i++) {
      fireEvent.click(screen.getByTestId('feature-tour-next'));
    }
    fireEvent.click(screen.getByTestId('feature-tour-finish'));
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('calls onSkip when Skip clicked', () => {
    const onSkip = vi.fn();
    render(
      <FeatureTour
        open
        onClose={() => {}}
        onComplete={() => {}}
        onSkip={onSkip}
      />,
    );
    fireEvent.click(screen.getByTestId('feature-tour-skip'));
    expect(onSkip).toHaveBeenCalledTimes(1);
  });

  it('skips on Escape key', () => {
    const onSkip = vi.fn();
    render(
      <FeatureTour
        open
        onClose={() => {}}
        onComplete={() => {}}
        onSkip={onSkip}
      />,
    );
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onSkip).toHaveBeenCalledTimes(1);
  });
});

describe('Feature tour content integrity', () => {
  it('has exactly 5 steps', () => {
    expect(FEATURE_TOUR_STEPS.length).toBe(5);
  });

  it('every step has title + body longer than threshold', () => {
    for (const step of FEATURE_TOUR_STEPS) {
      expect(step.title.length).toBeGreaterThan(5);
      expect(step.body.length).toBeGreaterThan(40);
    }
  });

  it('no em dashes in any step content', () => {
    const all = FEATURE_TOUR_STEPS.flatMap((s) => [s.title, s.body]).join(' ');
    expect(all).not.toMatch(/\u2014|&mdash;/);
  });

  it('no banned marketing words', () => {
    const all = FEATURE_TOUR_STEPS.flatMap((s) => [s.title, s.body]).join(' ');
    expect(all).not.toMatch(/\b(leverage|seamless|empower|unlock|delve|tapestry|elevate)\b/i);
  });
});
