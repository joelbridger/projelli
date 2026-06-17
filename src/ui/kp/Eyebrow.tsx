import type { CSSProperties, ReactNode } from 'react';

export interface EyebrowProps {
  /** Navy instead of muted — for named section headers that lead a group. */
  primary?: boolean;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}

/** Uppercase section / column label. One size, weight, and letter-spacing everywhere. */
export function Eyebrow({ primary = false, children, className, style }: EyebrowProps) {
  const classes = ['kp-eyebrow', primary ? 'kp-eyebrow--primary' : '', className ?? '']
    .filter(Boolean)
    .join(' ');
  return (
    <div className={classes} style={style}>
      {children}
    </div>
  );
}
