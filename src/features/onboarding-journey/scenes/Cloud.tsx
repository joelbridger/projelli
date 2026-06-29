import './sceneKeyframes.css';
import { motionClass } from './reducedMotion';

export interface CloudProps {
  reducedMotion?: boolean;
  className?: string;
  size?: number;
}

/**
 * Cloud — an AI company's servers. A soft, rounded cloud shape.
 */
export function Cloud({ reducedMotion = false, className = '', size = 80 }: CloudProps) {
  const w = size;
  const h = size;

  // Cloud body as a path of overlapping circles approximated with a path
  const cy = h * 0.5;
  const baseR = w * 0.22;

  // Simple cloud: one wide ellipse + three bumps on top
  const bumpCenters = [w * 0.26, w * 0.5, w * 0.74];
  const bumpR = [w * 0.17, w * 0.22, w * 0.16];

  return (
    <svg
      aria-hidden="true"
      className={[motionClass(reducedMotion, 'scene-drift'), className].filter(Boolean).join(' ')}
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* Base ellipse */}
      <ellipse
        cx={w / 2}
        cy={cy + baseR * 0.3}
        rx={w * 0.42}
        ry={baseR * 0.65}
        fill="var(--color-secondary)"
        stroke="var(--kp-navy)"
        strokeWidth={1.5}
      />
      {/* Bumps */}
      {bumpCenters.map((bx, i) => (
        <circle
          key={i}
          cx={bx}
          cy={cy - (bumpR[i] ?? baseR) * 0.3}
          r={bumpR[i] ?? baseR}
          fill="var(--color-secondary)"
          stroke="var(--kp-navy)"
          strokeWidth={1.5}
        />
      ))}
      {/* Cover the internal stroke lines by drawing over them */}
      <ellipse
        cx={w / 2}
        cy={cy + baseR * 0.38}
        rx={w * 0.39}
        ry={baseR * 0.55}
        fill="var(--color-secondary)"
      />
      {bumpCenters.map((bx, i) => (
        <circle
          key={`inner-${i}`}
          cx={bx}
          cy={cy - (bumpR[i] ?? baseR) * 0.3}
          r={(bumpR[i] ?? baseR) - 1.5}
          fill="var(--color-secondary)"
        />
      ))}
      {/* Small server dots */}
      {[w * 0.38, w * 0.5, w * 0.62].map((dx, i) => (
        <circle
          key={`dot-${i}`}
          cx={dx}
          cy={cy + baseR * 0.2}
          r={w * 0.025}
          fill="var(--kp-accent)"
          opacity={0.7}
        />
      ))}
    </svg>
  );
}
