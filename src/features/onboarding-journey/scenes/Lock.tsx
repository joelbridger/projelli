import './sceneKeyframes.css';
import { motionClass } from './reducedMotion';

export interface LockProps {
  reducedMotion?: boolean;
  className?: string;
  size?: number;
}

/**
 * Lock — privacy. A simple padlock shape.
 */
export function Lock({ reducedMotion = false, className = '', size = 80 }: LockProps) {
  const w = size;
  const h = size;

  const bodyW = w * 0.52;
  const bodyH = h * 0.4;
  const bodyX = (w - bodyW) / 2;
  const bodyY = h * 0.5;
  const bodyRx = w * 0.08;

  // Shackle (the U-shaped top)
  const shackleW = bodyW * 0.52;
  const shackleH = h * 0.32;
  const shackleX = (w - shackleW) / 2;
  const shackleY = bodyY - shackleH;
  const shackleStroke = w * 0.075;

  // Keyhole
  const khCx = w / 2;
  const khCy = bodyY + bodyH * 0.42;
  const khR = w * 0.06;

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
      {/* Shackle */}
      <path
        d={`
          M ${shackleX},${shackleY + shackleH}
          L ${shackleX},${shackleY + shackleStroke * 1.2}
          Q ${shackleX},${shackleY - shackleStroke * 0.2} ${w / 2},${shackleY - shackleStroke * 0.2}
          Q ${shackleX + shackleW},${shackleY - shackleStroke * 0.2} ${shackleX + shackleW},${shackleY + shackleStroke * 1.2}
          L ${shackleX + shackleW},${shackleY + shackleH}
        `}
        stroke="var(--kp-navy)"
        strokeWidth={shackleStroke}
        strokeLinecap="round"
        fill="none"
      />
      {/* Lock body */}
      <rect
        x={bodyX}
        y={bodyY}
        width={bodyW}
        height={bodyH}
        rx={bodyRx}
        fill="var(--kp-navy)"
      />
      {/* Keyhole circle */}
      <circle cx={khCx} cy={khCy} r={khR} fill="var(--color-background)" />
      {/* Keyhole slot */}
      <rect
        x={khCx - khR * 0.4}
        y={khCy}
        width={khR * 0.8}
        height={khR * 1.4}
        rx={khR * 0.2}
        fill="var(--color-background)"
      />
    </svg>
  );
}
