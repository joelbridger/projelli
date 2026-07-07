import { forwardRef } from 'react';
import type { ButtonHTMLAttributes } from 'react';
import type { IconType } from './types';

type IconButtonVariant = 'primary' | 'secondary' | 'ghost';
type IconButtonSize = 'xs' | 'sm' | 'md';

const ICON_SIZE: Record<IconButtonSize, number> = { xs: 12, sm: 14, md: 16 };

export interface IconButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className' | 'aria-label'> {
  icon: IconType;
  /** Accessible label — required (icon-only buttons must be announced). */
  label: string;
  variant?: IconButtonVariant;
  size?: IconButtonSize;
  className?: string;
  iconClassName?: string | undefined;
}

/** Icon-only button (close, refresh, clear, etc.) with a required accessible label. */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon: Icon, label, variant = 'ghost', size = 'sm', disabled, className, iconClassName, type = 'button', ...rest },
  ref,
) {
  const classes = [
    'kp-icon-btn',
    `kp-icon-btn--${variant}`,
    `kp-icon-btn--${size}`,
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={label}
      className={classes}
      disabled={disabled}
      {...rest}
    >
      <Icon size={ICON_SIZE[size]} strokeWidth={1.75} className={iconClassName} />
    </button>
  );
});
IconButton.displayName = 'IconButton';
