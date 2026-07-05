import '@/i18n';
import { describe, it, expect, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { LottiePlayer } from './LottiePlayer';

/**
 * QA-8 — the flow-chart intro icons visually overlapped the card heading
 * below them, reproducing as a duplicated/overlapping icon graphic. The real
 * root cause (confirmed by direct measurement in a real browser, NOT the
 * "svg sized to its native canvas" theory that looked plausible from the
 * JSON assets' wildly different w/h — 150x150 / 500x500 / 1920x1080 — but
 * turned out to be wrong: lottie-web already sizes the injected svg to
 * 100%/100% correctly on its own): a shared cancellation REF let a React
 * StrictMode dev-only double-invoke un-cancel a stale mount's in-flight
 * `import('lottie-web')`, so two animation instances both reached
 * `loadAnimation()` against the same container — and since lottie-web
 * APPENDS rather than replaces, the fixed-height container ended up with
 * two stacked svgs, the second overflowing onto the heading below. Fixed by
 * making the cancellation flag a closure-local variable instead of a ref
 * (see LottiePlayer.tsx's docblock) — verified live via Playwright
 * (tests/e2e/bench-mirror-onboarding-overlap.spec.ts), which is the only
 * environment that reproduces the real StrictMode timing race; this
 * component-level suite instead exercises `replaceChildren()`'s defensive
 * backstop deterministically via a `src` change (below), plus the plain
 * rendering paths that don't depend on that race at all.
 */
vi.mock('lottie-web', () => ({
  default: {
    loadAnimation: vi.fn((opts: { container: HTMLElement }) => {
      // Mirror lottie-web's real behavior closely enough to catch a
      // regression: it APPENDS an svg into the given container.
      opts.container.appendChild(document.createElement('svg'));
      return {
        destroy: vi.fn(),
        goToAndStop: vi.fn(),
      };
    }),
  },
}));

describe('LottiePlayer — QA-8 clip/scale class', () => {
  it('applies kp-onbv2-lottie once the animation loads', async () => {
    const { container } = render(<LottiePlayer src="/onboarding/lottie/step2.json" size={130} />);
    await waitFor(() => {
      expect(container.querySelector('.kp-onbv2-lottie')).toBeTruthy();
    });
  });

  it('preserves a caller-provided className alongside kp-onbv2-lottie', async () => {
    const { container } = render(
      <LottiePlayer src="/onboarding/lottie/step2.json" size={130} className="extra-class" />,
    );
    await waitFor(() => {
      const el = container.querySelector('.kp-onbv2-lottie');
      expect(el).toBeTruthy();
      expect(el?.className).toContain('extra-class');
    });
  });

  it('never accumulates more than one svg in the container across a src change', async () => {
    const { container, rerender } = render(
      <LottiePlayer src="/onboarding/lottie/step1.json" size={130} testId="icon" />,
    );
    await waitFor(() => {
      expect(container.querySelector('[data-testid="icon"] svg')).toBeTruthy();
    });
    rerender(<LottiePlayer src="/onboarding/lottie/step2.json" size={130} testId="icon" />);
    await waitFor(() => {
      const box = container.querySelector('[data-testid="icon"]');
      expect(box?.querySelectorAll('svg').length).toBe(1);
    });
  });

  it('still bounds the box (no overflow) on the load-failed fallback path', async () => {
    vi.doMock('lottie-web', () => {
      throw new Error('module not found');
    });
    vi.resetModules();
    const { LottiePlayer: FreshLottiePlayer } = await import('./LottiePlayer');
    const { container } = render(<FreshLottiePlayer src="/bad/path.json" size={130} />);
    await waitFor(() => {
      const el = container.firstElementChild as HTMLElement | null;
      expect(el).toBeTruthy();
      expect(el?.style.width).toBe('130px');
      expect(el?.style.height).toBe('130px');
    });
  });
});
