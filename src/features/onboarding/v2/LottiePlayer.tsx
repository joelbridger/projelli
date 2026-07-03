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

  useEffect(() => {
    // `local.cancelled` lives on an object created FRESH by this effect
    // invocation's closure — NOT a ref shared across invocations. Under
    // StrictMode (dev), React runs mount -> cleanup -> mount synchronously for
    // every effect; a shared ref meant run B's mount (which reset the ref to
    // false) could un-cancel run A's still-pending async work, so both
    // loadAnimation calls would proceed and append two <svg> instances into
    // the same container. An object scoped to this closure can only ever be
    // flipped by THIS invocation's own cleanup, so a superseded run can never
    // be revived by a later one. (A plain `let` instead of an object property
    // would read the same, but TS narrows a bare closed-over `let` read after
    // an `await` to its initial literal type, defeating the post-await guard.)
    const local = { cancelled: false };
    let anim: AnimItem | null = null;

    const reduceMotion =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    void (async () => {
      try {
        const mod = await import('lottie-web');
        const lottie = mod.default;
        if (local.cancelled || !containerRef.current) return;
        // Defense in depth: clear any stray prior content before mounting so
        // a duplicate render can never visually stack two icons even if some
        // other path (e.g. Fast Refresh) re-runs this effect without a clean
        // unmount in between.
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
        if (!local.cancelled) setFailed(true);
      }
    })();

    return () => {
      local.cancelled = true;
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
