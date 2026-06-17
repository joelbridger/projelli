import type { CSSProperties, ReactNode } from 'react';
import { ChevronDown, Filter } from 'lucide-react';
import { CountBadge } from './CountBadge';

export interface FilterToggleProps {
  open: boolean;
  onToggle: () => void;
  /** Active-filter count — shows a badge and keeps the toggle highlighted. */
  count?: number;
  label?: string;
  className?: string;
  'data-testid'?: string;
}

/** The one "Filters" toggle button — same height/badge on every surface. */
export function FilterToggle({
  open,
  onToggle,
  count = 0,
  label = 'Filters',
  className,
  'data-testid': testId,
}: FilterToggleProps) {
  const classes = ['kp-filter-toggle', open || count > 0 ? 'is-active' : '', className ?? '']
    .filter(Boolean)
    .join(' ');
  return (
    <button type="button" className={classes} onClick={onToggle} aria-expanded={open} data-testid={testId}>
      <Filter size={14} strokeWidth={1.75} />
      {label}
      {count > 0 ? <CountBadge count={count} /> : null}
      <ChevronDown
        size={12}
        strokeWidth={2}
        style={{
          transition: 'transform var(--kp-duration-fast) var(--kp-ease-standard)',
          transform: open ? 'rotate(180deg)' : 'none',
        }}
      />
    </button>
  );
}

export interface FilterPanelProps {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  'data-testid'?: string;
}

/** The expanded filter surface — full width, elevated, consistent on every surface. */
export function FilterPanel({ children, className, style, 'data-testid': testId }: FilterPanelProps) {
  return (
    <div
      className={['kp-filter-panel', className ?? ''].filter(Boolean).join(' ')}
      style={style}
      data-testid={testId}
    >
      {children}
    </div>
  );
}
