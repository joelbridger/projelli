import type { CSSProperties, ReactNode } from 'react';

export interface SurfaceToolbarProps {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  'data-testid'?: string;
}

/**
 * The standard tools row that sits directly beneath a surface header, holding
 * every tool for that tab (buttons, toggles, search, filters). Every tab is
 * Header -> SurfaceToolbar -> Content. Put right-aligned tools after a
 * `<ToolbarSpacer />` (or any element with `marginLeft: 'auto'`).
 */
export function SurfaceToolbar({ children, className, style, 'data-testid': testId }: SurfaceToolbarProps) {
  return (
    <div className={['kp-toolbar', className ?? ''].filter(Boolean).join(' ')} style={style} data-testid={testId}>
      {children}
    </div>
  );
}

/** Pushes the tools after it to the right edge of the toolbar. */
export function ToolbarSpacer() {
  return <div className="kp-toolbar__spacer" />;
}
