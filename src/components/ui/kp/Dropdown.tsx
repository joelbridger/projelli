import { forwardRef } from 'react';
import type { HTMLAttributes } from 'react';

export interface DropdownProps extends Omit<HTMLAttributes<HTMLDivElement>, 'className'> {
  className?: string;
}

/**
 * Anchored menu / popover container — the styled box that appears over a
 * trigger (matter picker, privilege menu, etc.). The caller owns open state,
 * outside-click dismissal, and positioning (pass top/left/right via `style`);
 * this provides the consistent surface (z-index, shadow, radius, background).
 */
export const Dropdown = forwardRef<HTMLDivElement, DropdownProps>(function Dropdown(
  { children, className, ...rest },
  ref,
) {
  return (
    <div ref={ref} className={['kp-dropdown', className ?? ''].filter(Boolean).join(' ')} {...rest}>
      {children}
    </div>
  );
});
Dropdown.displayName = 'Dropdown';
