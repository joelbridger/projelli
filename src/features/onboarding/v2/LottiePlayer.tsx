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
}

type AnimItem = { destroy: () => void; goToAndStop: (frame: number, isFrame: boolean) => void };

export function LottiePlayer({ src, size, className, ariaLabel }: LottiePlayerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [failed, setFailed] = useState(false);
  // Ref (not a plain boolean) so TS doesn't narrow the post-await guards to a
  // literal `false` — same pattern as useLocalLlmModelStatus.
  const cancelledRef = useRef(false);

  useEffect(() => {
    cancelledRef.current = false;
    const isCancelled = () => cancelledRef.current;
    let anim: AnimItem | null = null;

    const reduceMotion =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    void (async () => {
      try {
        const mod = await import('lottie-web');
        const lottie = mod.default;
        if (isCancelled() || !containerRef.current) return;
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
        if (!isCancelled()) setFailed(true);
      }
    })();

    return () => {
      cancelledRef.current = true;
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
      />
    );
  }

  return (
    <div
      ref={containerRef}
      className={className}
      style={{ width: size, height: size }}
      role={ariaLabel ? 'img' : undefined}
      aria-label={ariaLabel}
      aria-hidden={ariaLabel ? undefined : true}
    />
  );
}
