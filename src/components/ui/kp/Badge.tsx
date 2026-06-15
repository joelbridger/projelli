import type { ReactNode } from 'react';
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

export interface BadgeProps {
  variant?: BadgeVariant;
  size?: 'sm' | 'md';
  icon?: IconType;
  uppercase?: boolean;
  /** Monospace, lighter weight — for model names, matter numbers, the record. */
  mono?: boolean;
  children: ReactNode;
  className?: string;
  title?: string;
}

/** Non-interactive status / label pill. One radius, one padding scale, per-variant color. */
export function Badge({
  variant = 'neutral',
  size = 'sm',
  icon: Icon,
  uppercase = false,
  mono = false,
  children,
  className,
  title,
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
    <span className={classes} title={title}>
      {Icon ? <Icon size={iconSize} strokeWidth={1.75} /> : null}
      {children}
    </span>
  );
}
