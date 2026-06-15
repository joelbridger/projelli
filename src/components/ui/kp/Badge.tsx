import type { HTMLAttributes, ReactNode } from 'react';
import type { IconType } from './types';

type BadgeVariant =
  | 'neutral'
  | 'privilege'
  | 'sample'
  | 'local'
  | 'direct'
  | 'assured'
  | 'success'
  | 'warning'
  | 'danger'
  | 'featured';

export interface BadgeProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'className'> {
  variant?: BadgeVariant;
  size?: 'sm' | 'md';
  icon?: IconType;
  uppercase?: boolean;
  /** Monospace, lighter weight — for model names, matter numbers, the record. */
  mono?: boolean;
  children: ReactNode;
  className?: string;
}

/**
 * Non-interactive status / label pill. One radius, one padding scale, per-variant
 * color. Forwards DOM props (data-testid, aria-*, title, etc.) onto the span.
 */
export function Badge({
  variant = 'neutral',
  size = 'sm',
  icon: Icon,
  uppercase = false,
  mono = false,
  children,
  className,
  ...rest
}: BadgeProps) {
  const classes = [
    'kp-badge',
    `kp-badge--${variant}`,
    `kp-badge--${size}`,
    uppercase ? 'kp-badge--uppercase' : '',
    mono ? 'kp-badge--mono' : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');
  const iconSize = size === 'sm' ? 12 : 14;
  return (
    <span className={classes} {...rest}>
      {Icon ? <Icon size={iconSize} strokeWidth={1.75} /> : null}
      {children}
    </span>
  );
}
