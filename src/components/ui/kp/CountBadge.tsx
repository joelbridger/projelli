export interface CountBadgeProps {
  count: number;
  className?: string;
}

/** Small navy circle showing a count (active filters, unread, etc.). 18×18 everywhere. */
export function CountBadge({ count, className }: CountBadgeProps) {
  return <span className={['kp-count-badge', className ?? ''].filter(Boolean).join(' ')}>{count}</span>;
}
