import './sceneKeyframes.css';
import { motionClass } from './reducedMotion';

export interface PaperPlaneProps {
  reducedMotion?: boolean;
  className?: string;
  size?: number;
}

/**
 * PaperPlane — the user's question in flight. A classic paper plane shape.
 */
export function PaperPlane({ reducedMotion = false, className = '', size = 80 }: PaperPlaneProps) {
  const w = size;
  const h = size;

  // Paper plane pointing upper-right
  const cx = w * 0.5;
  const cy = h * 0.5;

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
      {/* Main plane body — triangle pointing right */}
      <polygon
        points={`
          ${cx + w * 0.36},${cy - h * 0.02}
          ${cx - w * 0.38},${cy - h * 0.26}
          ${cx - w * 0.18},${cy + h * 0.02}
          ${cx - w * 0.38},${cy + h * 0.3}
        `}
        fill="var(--kp-navy)"
        stroke="var(--kp-navy)"
        strokeWidth={1}
        strokeLinejoin="round"
      />
      {/* Fold crease — the bottom flap */}
      <line
        x1={cx - w * 0.18}
        y1={cy + h * 0.02}
        x2={cx + w * 0.36}
        y2={cy - h * 0.02}
        stroke="var(--color-background)"
        strokeWidth={1}
        opacity={0.5}
      />
      {/* Wing highlight */}
      <polygon
        points={`
          ${cx + w * 0.36},${cy - h * 0.02}
          ${cx - w * 0.38},${cy - h * 0.26}
          ${cx - w * 0.18},${cy + h * 0.02}
        `}
        fill="var(--kp-accent)"
        opacity={0.25}
      />
      {/* Motion trail dots */}
      {[w * 0.08, w * 0.04, 0].map((offset, i) => (
        <circle
          key={i}
          cx={cx - w * 0.44 - offset * 0.8}
          cy={cy + h * 0.36 - offset * 0.5}
          r={w * 0.022 - i * w * 0.005}
          fill="var(--kp-pink)"
          opacity={0.5 - i * 0.12}
        />
      ))}
    </svg>
  );
}
