import './sceneKeyframes.css';
import { motionClass } from './reducedMotion';

export interface FilingCabinetProps {
  reducedMotion?: boolean;
  className?: string;
  size?: number;
}

/**
 * FilingCabinet — the private search index being built. A simple two-drawer
 * filing cabinet shape with a small handle on each drawer.
 */
export function FilingCabinet({ reducedMotion = false, className = '', size = 80 }: FilingCabinetProps) {
  const w = size;
  const h = size;

  const cabinetW = w * 0.64;
  const cabinetH = h * 0.74;
  const cabinetX = (w - cabinetW) / 2;
  const cabinetY = (h - cabinetH) / 2 + h * 0.02;
  const rx = w * 0.04;

  const drawerH = (cabinetH - 3) / 2;
  const handleW = cabinetW * 0.4;
  const handleX = cabinetX + (cabinetW - handleW) / 2;
  const handleH = h * 0.038;
  const handleRx = handleH * 0.5;

  const drawer1Y = cabinetY + 1;
  const drawer2Y = cabinetY + drawerH + 2;

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
      {/* Cabinet body */}
      <rect
        x={cabinetX}
        y={cabinetY}
        width={cabinetW}
        height={cabinetH}
        rx={rx}
        fill="var(--color-secondary)"
        stroke="var(--kp-navy)"
        strokeWidth={1.5}
      />
      {/* Drawer 1 */}
      <rect
        x={cabinetX + 1.5}
        y={drawer1Y}
        width={cabinetW - 3}
        height={drawerH}
        rx={rx * 0.7}
        fill="var(--color-card)"
        stroke="var(--kp-navy)"
        strokeWidth={1}
      />
      {/* Drawer 1 handle */}
      <rect
        x={handleX}
        y={drawer1Y + drawerH * 0.55}
        width={handleW}
        height={handleH}
        rx={handleRx}
        fill="var(--kp-navy)"
        opacity={0.8}
      />
      {/* Drawer 2 */}
      <rect
        x={cabinetX + 1.5}
        y={drawer2Y}
        width={cabinetW - 3}
        height={drawerH}
        rx={rx * 0.7}
        fill="var(--color-card)"
        stroke="var(--kp-navy)"
        strokeWidth={1}
      />
      {/* Drawer 2 handle */}
      <rect
        x={handleX}
        y={drawer2Y + drawerH * 0.55}
        width={handleW}
        height={handleH}
        rx={handleRx}
        fill="var(--kp-navy)"
        opacity={0.8}
      />
      {/* Tab markers (file tab labels on top of drawer 1) */}
      <rect x={cabinetX + cabinetW * 0.12} y={drawer1Y + drawerH * 0.15} width={cabinetW * 0.2} height={h * 0.04} rx={2} fill="var(--kp-pink)" opacity={0.6} />
      <rect x={cabinetX + cabinetW * 0.38} y={drawer1Y + drawerH * 0.15} width={cabinetW * 0.2} height={h * 0.04} rx={2} fill="var(--kp-blue)" opacity={0.5} />
      <rect x={cabinetX + cabinetW * 0.64} y={drawer1Y + drawerH * 0.15} width={cabinetW * 0.2} height={h * 0.04} rx={2} fill="var(--kp-accent)" opacity={0.4} />
      {/* Feet */}
      <rect x={cabinetX + cabinetW * 0.15} y={cabinetY + cabinetH - 1} width={cabinetW * 0.2} height={h * 0.04} rx={1} fill="var(--kp-navy)" opacity={0.5} />
      <rect x={cabinetX + cabinetW * 0.65} y={cabinetY + cabinetH - 1} width={cabinetW * 0.2} height={h * 0.04} rx={1} fill="var(--kp-navy)" opacity={0.5} />
    </svg>
  );
}
