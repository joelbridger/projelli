/**
 * LottiePlayer — tiny wrapper around lottie-web for the intro flowchart icons.
 *
 * Robustness first: the animation is decorative, so if lottie-web fails to
 * import, the JSON 404s, or rendering throws, we fall back to a neutral
 * placeholder rather than breaking the first-run screen. Animations are
 * bundled/served locally (no CDN) so the app stays offline-capable.
 *
 * Honors prefers-reduced-motion: when set, the animation loads paused on its
 * first frame instead of looping.
 *
 * QA-8 — the cancellation flag below is a plain closure-local variable, NOT a
 * ref, precisely so a React StrictMode dev-only double-invoke (mount ->
 * cleanup -> mount) can't race two instances of this effect: a shared ref
 * would let the SECOND mount's `ref.current = false` reset un-cancel the
 * FIRST mount's still in-flight `import('lottie-web')`, so both would go on
 * to call loadAnimation() against the same container — and since
 * lottie-web APPENDS rather than replaces, the container ends up with two
 * stacked svg instances that overflow its fixed-height box onto whatever
 * sits below it (this is what the original QA-8 screenshots actually show:
 * a duplicated, overlapping icon). A fresh local variable per invocation
 * can never be touched by another invocation's cleanup, so only the
 * surviving (not-yet-cancelled) instance ever reaches loadAnimation().
 */

import { useEffect, useRef, useState } from 'react';

export interface LottiePlayerProps {
  /** Path to a Lottie JSON, served from /public (e.g. '/onboarding/lottie/step1.json'). */
  src: string;
  /** Square render size in px. */
  size: number;
  className?: string;
  /** Accessible label (the animation is decorative by default). */
  ariaLabel?: string;
  /** QA-8 — stable E2E hook for the icon's own box (overlap regression specs). */
  testId?: string;
}

type AnimItem = { destroy: () => void; goToAndStop: (frame: number, isFrame: boolean) => void };

export function LottiePlayer({ src, size, className, ariaLabel, testId }: LottiePlayerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    // Deliberately a closure-local variable, not a ref — see the QA-8
    // docblock above for why a shared ref caused a real double-mount bug.
    let cancelled = false;
    let anim: AnimItem | null = null;

    const reduceMotion =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    void (async () => {
      try {
        const mod = await import('lottie-web');
        const lottie = mod.default;
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- `cancelled` is mutated by this effect's own cleanup after this await, which TS can't see across the async boundary.
        if (cancelled || !containerRef.current) return;
        // Defensive backstop: this container is only ever meant to hold one
        // animation's svg, so clear it first regardless of how we got here.
        containerRef.current.replaceChildren();
        const instance = lottie.loadAnimation({
          container: containerRef.current,
          renderer: 'svg',
          loop: !reduceMotion,
          autoplay: !reduceMotion,
          path: src,
        }) as unknown as AnimItem;
        anim = instance;
        if (reduceMotion) {
          // Park on the first frame so it reads as a crisp static icon.
          try {
            instance.goToAndStop(0, true);
          } catch {
            /* non-fatal */
          }
        }
      } catch {
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- see above.
        if (!cancelled) setFailed(true);
      }
    })();

    return () => {
      cancelled = true;
      if (anim) {
        try {
          anim.destroy();
        } catch {
          /* non-fatal */
        }
      }
    };
  }, [src]);

  if (failed) {
    // Neutral brand-tinted placeholder so the layout never collapses.
    return (
      <div
        className={className}
        style={{
          width: size,
          height: size,
          borderRadius: 18,
          background: 'rgba(31, 116, 196, 0.08)',
        }}
        aria-hidden="true"
        {...(testId ? { 'data-testid': testId } : {})}
      />
    );
  }

  return (
    <div
      ref={containerRef}
      // QA-8: `kp-onbv2-lottie` is a defensive clip on this box — see
      // onboardingV2.css for the real root cause (a StrictMode double-mount
      // leak in the effect above, now fixed at the source).
      className={className ? `kp-onbv2-lottie ${className}` : 'kp-onbv2-lottie'}
      style={{ width: size, height: size }}
      role={ariaLabel ? 'img' : undefined}
      aria-label={ariaLabel}
      aria-hidden={ariaLabel ? undefined : true}
      {...(testId ? { 'data-testid': testId } : {})}
    />
  );
}
