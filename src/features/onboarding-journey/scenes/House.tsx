import './sceneKeyframes.css';
import { motionClass } from './reducedMotion';

export interface HouseProps {
  reducedMotion?: boolean;
  className?: string;
  size?: number;
}

/**
 * House — the user's computer / private space.
 * A warm little house with a pitched roof, walls, and a small door.
 */
export function House({ reducedMotion = false, className = '', size = 80 }: HouseProps) {
  const w = size;
  const h = size;

  // Proportions
  const wallTop = h * 0.42;
  const wallH = h * 0.52;
  const doorW = w * 0.22;
  const doorH = wallH * 0.42;
  const doorX = (w - doorW) / 2;
  const doorY = h - doorH;

  return (
    <svg
      aria-hidden="true"
      className={[motionClass(reducedMotion, 'scene-pop'), className].filter(Boolean).join(' ')}
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* Roof */}
      <polygon
        points={`${w * 0.5},${h * 0.04} ${w * 0.06},${wallTop} ${w * 0.94},${wallTop}`}
        fill="var(--kp-navy)"
      />
      {/* Chimney */}
      <rect
        x={w * 0.64}
        y={h * 0.06}
        width={w * 0.1}
        height={h * 0.2}
        rx={2}
        fill="var(--kp-navy)"
      />
      {/* Walls */}
      <rect
        x={w * 0.1}
        y={wallTop}
        width={w * 0.8}
        height={wallH}
        rx={3}
        fill="var(--color-secondary)"
        stroke="var(--kp-navy)"
        strokeWidth={1.5}
      />
      {/* Door */}
      <rect
        x={doorX}
        y={doorY}
        width={doorW}
        height={doorH}
        rx={doorW * 0.4}
        fill="var(--kp-accent)"
        stroke="var(--kp-navy)"
        strokeWidth={1}
      />
      {/* Door knob */}
      <circle
        cx={doorX + doorW * 0.75}
        cy={doorY + doorH * 0.55}
        r={w * 0.025}
        fill="var(--kp-navy)"
      />
      {/* Window */}
      <rect
        x={w * 0.2}
        y={wallTop + wallH * 0.18}
        width={w * 0.18}
        height={h * 0.15}
        rx={2}
        fill="var(--kp-blue)"
        opacity={0.7}
        stroke="var(--kp-navy)"
        strokeWidth={1}
      />
    </svg>
  );
}
