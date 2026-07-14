/**
 * FeatureTour unit tests — exercises the 11-step popover/dialog flow plus
 * data-integrity assertions against featureTourSteps.ts.
 *
 * The tour targets the 3-tab Spine nav (spine-nav-{matters,search,workflows}),
 * the settings gear (settings-gear, where the relocated Activity Log / Privacy
 * Center / Settings live), and account-identity. When an anchor is absent
 * FeatureTour auto-advances — intentional and acceptable (noted in docs).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { FeatureTour } from '@/features/onboarding/FeatureTour';
import { FEATURE_TOUR_STEPS } from '@/features/onboarding/featureTourSteps';

// Seed the new Spine nav testids so anchored steps resolve instead of
// auto-advancing. Matches the data-testid attrs on Spine buttons.
function seedTargets(): () => void {
  const container = document.createElement('div');
  const targets = [
    'spine-nav-matters',
    'spine-nav-search',
    'spine-nav-workflows',
    'settings-gear',
    'account-identity',
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

  it('fully releases the modal layer so app content is hit-testable after Skip', async () => {
    function TourHarness() {
      const [open, setOpen] = useState(true);
      return (
        <>
          <button type="button" data-testid="app-hit-target">App content</button>
          <FeatureTour
            open={open}
            onClose={() => setOpen(false)}
            onComplete={() => setOpen(false)}
            onSkip={() => setOpen(false)}
          />
        </>
      );
    }

    const originalElementFromPoint = document.elementFromPoint;
    const appTarget = render(<TourHarness />).getByTestId('app-hit-target');
    const targetRect = {
      x: 20,
      y: 20,
      top: 20,
      left: 20,
      right: 220,
      bottom: 60,
      width: 200,
      height: 40,
      toJSON: () => ({}),
    } as DOMRect;
    appTarget.getBoundingClientRect = () => targetRect;

    // jsdom has no layout engine, so model the browser rule that a live modal
    // layer or Radix's body pointer lock wins the hit test over app content.
    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: () => {
        const openTourLayer = Array.from(document.body.children).find((element) =>
          element.querySelector('[data-testid="feature-tour-center"]'));
        if (openTourLayer || document.body.style.pointerEvents === 'none') {
          return openTourLayer ?? document.documentElement;
        }
        return appTarget;
      },
    });

    try {
      expect(document.elementFromPoint(120, 40)).not.toBe(appTarget);
      fireEvent.click(screen.getByTestId('feature-tour-skip'));

      await waitFor(() => {
        expect(screen.queryByTestId('feature-tour-center')).not.toBeInTheDocument();
        expect(document.body.style.pointerEvents).not.toBe('none');
        expect(document.elementFromPoint(120, 40)).toBe(appTarget);
      });
    } finally {
      Object.defineProperty(document, 'elementFromPoint', {
        configurable: true,
        value: originalElementFromPoint,
      });
    }
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
  it('has exactly 11 steps', () => {
    expect(FEATURE_TOUR_STEPS.length).toBe(11);
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

  it('uses the 3-tab spine-nav selectors, the settings gear, and account-identity', () => {
    const selectors = FEATURE_TOUR_STEPS
      .map((s) => s.targetSelector)
      .filter((s): s is string => s !== null);
    expect(selectors.some((s) => s.includes('spine-nav-matters'))).toBe(true);
    expect(selectors.some((s) => s.includes('spine-nav-search'))).toBe(true);
    expect(selectors.some((s) => s.includes('spine-nav-workflows'))).toBe(true);
    expect(selectors.some((s) => s.includes('settings-gear'))).toBe(true);
    expect(selectors.some((s) => s.includes('account-identity'))).toBe(true);
  });

  it('has no demoted rail-tab selectors (files/email/audit/privacy/settings as rail tabs)', () => {
    const selectors = FEATURE_TOUR_STEPS
      .map((s) => s.targetSelector)
      .filter((s): s is string => s !== null);
    for (const sel of selectors) {
      expect(sel).not.toMatch(/sidebar-tab-/);
      expect(sel).not.toMatch(/spine-nav-(files|email|audit|privacy|settings)/);
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

  // E5-headline (trust review): the outro's privacy line must be scoped to
  // documents/prompts, not an unqualified "nothing leaves" — the app still
  // contacts its own servers automatically for a periodic license check
  // (and optionally for telemetry/bug reports) regardless of AI/connector
  // choice, per the Data Map's own "What Lantern's own servers
  // see" row. Caught by Codex self-review of this same fix.
  it('outro privacy line is scoped to documents/prompts, not an absolute "nothing leaves"', () => {
    const outro = FEATURE_TOUR_STEPS.find((s) => s.id === 'outro');
    const body = (outro?.body ?? '').toLowerCase();
    expect(body).not.toMatch(/^nothing leaves|[^t]\bnothing leaves\b/);
    expect(body).toMatch(/documents and prompts/);
  });
});
