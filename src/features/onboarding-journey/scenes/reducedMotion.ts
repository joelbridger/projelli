/**
 * Returns the animation class when motion is allowed, or an empty string
 * when the user has requested reduced motion. Apply to every animated element
 * so the static "final frame" is always shown when reducedMotion is true.
 *
 * Usage:
 *   className={motionClass(reducedMotion, 'scene-pop')}
 */
export function motionClass(reducedMotion: boolean, animatedClass: string): string {
  return reducedMotion ? '' : animatedClass;
}
