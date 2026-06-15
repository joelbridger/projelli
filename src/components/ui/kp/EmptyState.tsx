import type { ReactNode } from 'react';
import type { IconType } from './types';

export interface EmptyStateProps {
  icon: IconType;
  title: string;
  body?: string;
  /** Buttons / chips rendered below the body (e.g. a primary CTA). */
  actions?: ReactNode;
  /** Tighter padding for empty states that live inside a card. */
  compact?: boolean;
  iconSize?: number;
  className?: string;
}

/** One empty-state layout: icon → title → body → optional actions, centered. */
export function EmptyState({
  icon: Icon,
  title,
  body,
  actions,
  compact = false,
  iconSize = 32,
  className,
}: EmptyStateProps) {
  const classes = ['kp-empty', compact ? 'kp-empty--compact' : '', className ?? '']
    .filter(Boolean)
    .join(' ');
  return (
    <div className={classes}>
      <span className="kp-empty__icon">
        <Icon size={iconSize} strokeWidth={1.5} />
      </span>
      <div className="kp-empty__title">{title}</div>
      {body ? <p className="kp-empty__body">{body}</p> : null}
      {actions ? <div className="kp-empty__actions">{actions}</div> : null}
    </div>
  );
}
