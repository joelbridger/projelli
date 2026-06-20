import './sceneKeyframes.css';
import { motionClass } from './reducedMotion';

export interface BrainProps {
  reducedMotion?: boolean;
  className?: string;
  size?: number;
}

/**
 * Brain — the AI you "plug in". A friendly glowing brain with a small plug connector.
 */
export function Brain({ reducedMotion = false, className = '', size = 80 }: BrainProps) {
  const w = size;
  const h = size;
  const cx = w / 2;
  const cy = h * 0.44;
  const r = h * 0.3;

  // Plug prongs at the bottom
  const prongY = cy + r + h * 0.04;
  const prongH = h * 0.12;
  const prongW = w * 0.06;
  const prongGap = w * 0.12;

  return (
    <svg
      aria-hidden="true"
      className={[motionClass(reducedMotion, 'scene-pulse'), className].filter(Boolean).join(' ')}
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* Glow halo */}
      <circle
        cx={cx}
        cy={cy}
        r={r * 1.25}
        fill="var(--kp-blue)"
        opacity={0.15}
      />
      {/* Brain blob — simplified organic shape via ellipse + bumps */}
      <ellipse
        cx={cx}
        cy={cy}
        rx={r}
        ry={r * 0.85}
        fill="var(--kp-pink)"
        opacity={0.15}
      />
      {/* Main brain circle */}
      <circle
        cx={cx}
        cy={cy}
        r={r}
        fill="url(#brain-grad)"
        stroke="var(--kp-navy)"
        strokeWidth={1.5}
      />
      {/* Left hemisphere divot */}
      <path
        d={`M ${cx - r * 0.15},${cy - r * 0.5} Q ${cx},${cy - r * 0.05} ${cx - r * 0.15},${cy + r * 0.4}`}
        stroke="var(--kp-navy)"
        strokeWidth={1.2}
        fill="none"
        opacity={0.4}
      />
      {/* Thinking dots */}
      {[cx - w * 0.1, cx, cx + w * 0.1].map((dotX, i) => (
        <circle
          key={i}
          cx={dotX}
          cy={cy}
          r={w * 0.028}
          fill="var(--kp-navy)"
          opacity={0.7}
          className={motionClass(reducedMotion, `scene-dot-${i + 1}` as `scene-dot-${1 | 2 | 3}`)}
        />
      ))}
      {/* Plug body */}
      <rect
        x={cx - prongGap * 0.8}
        y={prongY}
        width={prongGap * 1.6}
        height={prongH * 0.7}
        rx={2}
        fill="var(--kp-navy)"
        opacity={0.9}
      />
      {/* Plug prongs */}
      <rect x={cx - prongGap / 2 - prongW / 2} y={prongY + prongH * 0.65} width={prongW} height={prongH} rx={1} fill="var(--kp-navy)" />
      <rect x={cx + prongGap / 2 - prongW / 2} y={prongY + prongH * 0.65} width={prongW} height={prongH} rx={1} fill="var(--kp-navy)" />

      {/* Gradient def */}
      <defs>
        <linearGradient id="brain-grad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="var(--kp-pink)" stopOpacity="0.3" />
          <stop offset="100%" stopColor="var(--kp-blue)" stopOpacity="0.3" />
        </linearGradient>
      </defs>
    </svg>
  );
}
