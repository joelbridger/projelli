import type { ReactNode } from 'react';

export interface SceneFrameProps {
  /** Plain-language description of what this scene shows. Used as aria-label. */
  label: string;
  className?: string;
  children: ReactNode;
}

/**
 * Wrapper that gives a metaphor scene its single accessible description.
 *
 * The frame itself carries role="img" + aria-label so a screen reader hears
 * one plain sentence (e.g. "Your computer, a private space") rather than a
 * flood of decorative SVG details. The inner content is marked aria-hidden
 * so assistive technology ignores it entirely.
 */
export function SceneFrame({ label, className, children }: SceneFrameProps) {
  return (
    <div
      role="img"
      aria-label={label}
      className={className}
      style={{ position: 'relative', display: 'inline-block' }}
    >
      <div aria-hidden="true" style={{ display: 'contents' }}>
        {children}
      </div>
    </div>
  );
}
