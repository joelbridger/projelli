import './sceneKeyframes.css';
import { motionClass } from './reducedMotion';

export interface PapersProps {
  reducedMotion?: boolean;
  className?: string;
  size?: number;
}

/**
 * Papers — a small stack of document shapes representing files/documents.
 */
export function Papers({ reducedMotion = false, className = '', size = 80 }: PapersProps) {
  const w = size;
  const h = size;

  // Three layered document rectangles, slightly offset for depth
  const docW = w * 0.6;
  const docH = h * 0.72;
  const cornerFold = w * 0.14;

  function Doc({
    x,
    y,
    opacity,
    fill,
  }: {
    x: number;
    y: number;
    opacity: number;
    fill: string;
  }) {
    // folded corner triangle clip: polygon for the document shape
    const right = x + docW;
    const bottom = y + docH;
    const foldX = right - cornerFold;
    const foldY = y + cornerFold;
    const points = [
      `${x},${y}`,
      `${foldX},${y}`,
      `${right},${foldY}`,
      `${right},${bottom}`,
      `${x},${bottom}`,
    ].join(' ');

    return (
      <g opacity={opacity}>
        <polygon
          points={points}
          fill={fill}
          stroke="var(--kp-navy)"
          strokeWidth={1.2}
        />
        {/* Fold crease */}
        <polyline
          points={`${foldX},${y} ${foldX},${foldY} ${right},${foldY}`}
          fill="none"
          stroke="var(--kp-navy)"
          strokeWidth={1}
          opacity={0.5}
        />
        {/* Lines of text */}
        {[0.38, 0.52, 0.66].map((t, i) => (
          <line
            key={i}
            x1={x + docW * 0.15}
            y1={y + docH * t}
            x2={x + docW * 0.75}
            y2={y + docH * t}
            stroke="var(--kp-navy)"
            strokeWidth={1.5}
            strokeLinecap="round"
            opacity={0.4}
          />
        ))}
      </g>
    );
  }

  const baseX = (w - docW) / 2;
  const baseY = (h - docH) / 2;

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
      {/* Back doc */}
      <Doc x={baseX + w * 0.1} y={baseY - h * 0.05} opacity={0.4} fill="var(--color-secondary)" />
      {/* Middle doc */}
      <Doc x={baseX + w * 0.05} y={baseY + h * 0.02} opacity={0.65} fill="var(--color-card)" />
      {/* Front doc */}
      <Doc x={baseX} y={baseY + h * 0.08} opacity={1} fill="var(--color-background)" />
    </svg>
  );
}
