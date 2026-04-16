/**
 * GradientGlow — decorative background element
 *
 * A CSS-only radial glow using the brand gradient
 * (blue-500 / purple-500 / pink-500) at very low opacity with heavy blur.
 * Positioned absolutely behind the logo area on the start screen.
 * No images involved.
 */

interface GradientGlowProps {
  /** Additional className for positioning or sizing overrides */
  className?: string;
}

export function GradientGlow({ className = '' }: GradientGlowProps) {
  return (
    <div
      aria-hidden="true"
      className={`pointer-events-none absolute w-96 h-96 rounded-full bg-gradient-to-br from-blue-500/[0.06] via-purple-500/[0.06] to-pink-500/[0.06] blur-[100px] ${className}`}
    />
  );
}
