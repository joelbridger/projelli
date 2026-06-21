import './sceneKeyframes.css';
import { motionClass } from './reducedMotion';

export interface KeyShapeProps {
  reducedMotion?: boolean;
  className?: string;
  size?: number;
}

/**
 * KeyShape — the account key. A small classic key shape.
 */
export function KeyShape({ reducedMotion = false, className = '', size = 80 }: KeyShapeProps) {
  const w = size;
  const h = size;

  // Key bow (round part) on the left
  const bowCx = w * 0.32;
  const bowCy = h * 0.42;
  const bowR = w * 0.2;
  const bowInnerR = w * 0.11;

  // Key blade extends to the right
  const bladeY = bowCy;
  const bladeX1 = bowCx + bowR;
  const bladeX2 = w * 0.88;
  const bladeH = h * 0.09;

  // Teeth cut-outs (two small notches)
  const tooth1X = w * 0.62;
  const tooth2X = w * 0.74;
  const toothH = h * 0.1;
  const toothW = w * 0.055;

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
      {/* Key bow outer ring */}
      <circle
        cx={bowCx}
        cy={bowCy}
        r={bowR}
        fill="var(--kp-accent)"
        stroke="var(--kp-navy)"
        strokeWidth={1.5}
      />
      {/* Key bow hole */}
      <circle
        cx={bowCx}
        cy={bowCy}
        r={bowInnerR}
        fill="var(--color-background)"
        stroke="var(--kp-navy)"
        strokeWidth={1}
      />
      {/* Key blade */}
      <rect
        x={bladeX1 - 2}
        y={bladeY - bladeH / 2}
        width={bladeX2 - bladeX1 + 2}
        height={bladeH}
        rx={bladeH * 0.3}
        fill="var(--kp-navy)"
      />
      {/* Tooth 1 */}
      <rect
        x={tooth1X}
        y={bladeY + bladeH / 2}
        width={toothW}
        height={toothH}
        rx={1}
        fill="var(--kp-navy)"
      />
      {/* Tooth 2 */}
      <rect
        x={tooth2X}
        y={bladeY + bladeH / 2}
        width={toothW}
        height={toothH * 0.7}
        rx={1}
        fill="var(--kp-navy)"
      />
    </svg>
  );
}
