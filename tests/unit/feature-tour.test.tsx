/**
 * FeatureTour unit tests — exercises the 7-step popover/dialog flow plus
 * data-integrity assertions against featureTourSteps.ts.
 *
 * The tour targets the new Spine nav: spine-nav-{matters,search,files,email,audit}.
 * On the old shell those elements are absent and FeatureTour auto-advances —
 * that is intentional and acceptable behaviour (noted in docs).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FeatureTour } from '@/features/onboarding/FeatureTour';
import { FEATURE_TOUR_STEPS } from '@/features/onboarding/featureTourSteps';

// Seed the new Spine nav testids so anchored steps resolve instead of
// auto-advancing. Matches the data-testid attrs on Spine buttons.
function seedTargets(): () => void {
  const container = document.createElement('div');
  const targets = [
    'spine-nav-matters',
    'spine-nav-search',
    'spine-nav-files',
    'spine-nav-email',
    'spine-nav-audit',
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
    expect(screen.getAllByText('A quick look at the new layout').length).toBeGreaterThan(0);
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
  it('has exactly 7 steps', () => {
    expect(FEATURE_TOUR_STEPS.length).toBe(7);
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

  it('uses new spine-nav-* selectors', () => {
    const selectors = FEATURE_TOUR_STEPS
      .map((s) => s.targetSelector)
      .filter((s): s is string => s !== null);
    expect(selectors.some((s) => s.includes('spine-nav-matters'))).toBe(true);
    expect(selectors.some((s) => s.includes('spine-nav-search'))).toBe(true);
    expect(selectors.some((s) => s.includes('spine-nav-files'))).toBe(true);
    expect(selectors.some((s) => s.includes('spine-nav-email'))).toBe(true);
    expect(selectors.some((s) => s.includes('spine-nav-audit'))).toBe(true);
  });

  it('has no legacy sidebar-tab-* selectors', () => {
    const selectors = FEATURE_TOUR_STEPS
      .map((s) => s.targetSelector)
      .filter((s): s is string => s !== null);
    for (const sel of selectors) {
      expect(sel).not.toMatch(/sidebar-tab-/);
    }
  });

  it('intro and outro steps are center-modal (targetSelector null)', () => {
    const intro = FEATURE_TOUR_STEPS.find((s) => s.id === 'intro');
    const outro = FEATURE_TOUR_STEPS.find((s) => s.id === 'outro');
    expect(intro?.targetSelector).toBeNull();
    expect(intro?.placement).toBe('center');
    expect(outro?.targetSelector).toBeNull();
    expect(outro?.placement).toBe('center');
  });
});
