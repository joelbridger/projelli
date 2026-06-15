import { forwardRef } from 'react';
import type { HTMLAttributes } from 'react';

type CardVariant = 'flat' | 'raised' | 'interactive';

export interface CardProps extends Omit<HTMLAttributes<HTMLDivElement>, 'className'> {
  /** `flat` = list/table wrapper (no shadow/pad); `raised` = info panel; `interactive` = clickable result. */
  variant?: CardVariant;
  /** Navy 1.5px border + tinted fill (the "start here" / selected card). */
  featured?: boolean;
  className?: string;
}

/** The one card container. Variant sets shadow + padding; everything else is a token. */
export const Card = forwardRef<HTMLDivElement, CardProps>(function Card(
  { variant = 'raised', featured = false, children, className, ...rest },
  ref,
) {
  const classes = [
    'kp-card',
    `kp-card--${variant}`,
    featured ? 'kp-card--featured' : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <div ref={ref} className={classes} {...rest}>
      {children}
    </div>
  );
});
Card.displayName = 'Card';
