import { forwardRef } from 'react';
import type { ButtonHTMLAttributes } from 'react';
import type { IconType } from './types';

export interface ChipProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className'> {
  active?: boolean;
  size?: 'sm' | 'md' | 'pill';
  icon?: IconType;
  className?: string;
}

/** Interactive filter / selection chip (pill-shaped). Navy fill when active. */
export const Chip = forwardRef<HTMLButtonElement, ChipProps>(function Chip(
  { active = false, size = 'sm', icon: Icon, children, className, type = 'button', ...rest },
  ref,
) {
  const classes = ['kp-chip', `kp-chip--${size}`, active ? 'is-active' : '', className ?? '']
    .filter(Boolean)
    .join(' ');
  return (
    <button ref={ref} type={type} className={classes} aria-pressed={active} {...rest}>
      {Icon ? <Icon size={size === 'sm' ? 12 : 14} strokeWidth={1.75} /> : null}
      {children}
    </button>
  );
});
Chip.displayName = 'Chip';
