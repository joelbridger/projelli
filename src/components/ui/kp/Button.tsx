import { forwardRef } from 'react';
import type { ButtonHTMLAttributes } from 'react';
import { Loader2 } from 'lucide-react';
import type { IconType } from './types';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'link';
type ButtonSize = 'sm' | 'md' | 'lg';

// Icon size is derived from the button size — never passed ad-hoc.
const ICON_SIZE: Record<ButtonSize, number> = { sm: 14, md: 16, lg: 16 };

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className'> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Leading icon component (e.g. lucide `Plus`). Sized from `size`. */
  iconLeft?: IconType;
  /** Trailing icon component. Sized from `size`. */
  iconRight?: IconType;
  loading?: boolean;
  fullWidth?: boolean;
  className?: string;
}

/**
 * The single button primitive for the reimagined shell. Variant sets the look,
 * size sets the height/padding/font/icon — so "New matter" and "New email" are
 * the same control with the same dimensions, by construction.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'primary',
    size = 'md',
    iconLeft: IconLeft,
    iconRight: IconRight,
    loading = false,
    fullWidth = false,
    disabled,
    children,
    className,
    type = 'button',
    ...rest
  },
  ref,
) {
  const iconSize = ICON_SIZE[size];
  const classes = [
    'kp-btn',
    `kp-btn--${variant}`,
    variant === 'link' ? '' : `kp-btn--${size}`,
    fullWidth ? 'kp-btn--full' : '',
    loading ? 'is-loading' : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <button
      ref={ref}
      type={type}
      className={classes}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? (
        <Loader2 size={iconSize} strokeWidth={2} className="animate-spin" />
      ) : IconLeft ? (
        <IconLeft size={iconSize} strokeWidth={1.75} />
      ) : null}
      {children}
      {IconRight && !loading ? <IconRight size={iconSize} strokeWidth={1.75} /> : null}
    </button>
  );
});
Button.displayName = 'Button';
