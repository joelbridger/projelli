import type { ReactNode } from 'react';
import { X } from 'lucide-react';
import type { IconType } from './types';
import { IconButton } from './IconButton';

export interface CalloutProps {
  variant?: 'info' | 'warning' | 'error';
  icon?: IconType;
  onDismiss?: () => void;
  children: ReactNode;
  className?: string;
}

/** Informational / warning / error banner. Dismissible when `onDismiss` is given. */
export function Callout({ variant = 'info', icon: Icon, onDismiss, children, className }: CalloutProps) {
  const classes = ['kp-callout', `kp-callout--${variant}`, className ?? ''].filter(Boolean).join(' ');
  return (
    <div className={classes} role={variant === 'error' ? 'alert' : undefined}>
      {Icon ? (
        <span style={{ flex: 'none', display: 'inline-flex', marginTop: 2 }}>
          <Icon size={16} strokeWidth={1.75} />
        </span>
      ) : null}
      <div style={{ flex: 1, minWidth: 0 }}>{children}</div>
      {onDismiss ? <IconButton icon={X} label="Dismiss" size="xs" variant="ghost" onClick={onDismiss} /> : null}
    </div>
  );
}
