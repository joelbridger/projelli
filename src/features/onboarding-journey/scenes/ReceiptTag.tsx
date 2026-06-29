import './sceneKeyframes.css';
import { motionClass } from './reducedMotion';

export interface ReceiptTagProps {
  reducedMotion?: boolean;
  className?: string;
  size?: number;
}

/**
 * ReceiptTag — a citation/source. A little tag or receipt label with a hole punch.
 */
export function ReceiptTag({ reducedMotion = false, className = '', size = 80 }: ReceiptTagProps) {
  const w = size;
  const h = size;

  const tagW = w * 0.62;
  const tagH = h * 0.72;
  const tagX = (w - tagW) / 2;
  const tagY = (h - tagH) / 2 + h * 0.04;

  // Notch at bottom
  const notchR = w * 0.08;
  const notchCx = tagX + tagW / 2;
  const notchCy = tagY + tagH;

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
      {/* Tag body with a V-notch at the bottom */}
      <path
        d={`
          M ${tagX},${tagY}
          L ${tagX + tagW},${tagY}
          L ${tagX + tagW},${tagY + tagH - notchR}
          Q ${notchCx + notchR * 0.5},${notchCy - notchR * 0.4} ${notchCx},${notchCy - notchR * 1.1}
          Q ${notchCx - notchR * 0.5},${notchCy - notchR * 0.4} ${tagX},${tagY + tagH - notchR}
          Z
        `}
        fill="var(--color-secondary)"
        stroke="var(--kp-navy)"
        strokeWidth={1.5}
        strokeLinejoin="round"
      />
      {/* Hole punch */}
      <circle
        cx={notchCx}
        cy={tagY + tagH * 0.14}
        r={notchR * 0.55}
        fill="var(--color-background)"
        stroke="var(--kp-navy)"
        strokeWidth={1.2}
      />
      {/* Text lines */}
      {[0.32, 0.48, 0.64].map((t, i) => (
        <line
          key={i}
          x1={tagX + tagW * 0.18}
          y1={tagY + tagH * t}
          x2={tagX + tagW * (i === 2 ? 0.65 : 0.82)}
          y2={tagY + tagH * t}
          stroke="var(--kp-navy)"
          strokeWidth={1.4}
          strokeLinecap="round"
          opacity={0.45}
        />
      ))}
      {/* Accent dot (cited source highlight) */}
      <circle
        cx={tagX + tagW * 0.18}
        cy={tagY + tagH * 0.32}
        r={w * 0.03}
        fill="var(--kp-pink)"
        opacity={0.8}
      />
    </svg>
  );
}
