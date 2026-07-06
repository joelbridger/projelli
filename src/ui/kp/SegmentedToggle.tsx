import type { IconType } from './types';

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  icon?: IconType;
  /** Explicit test handle for this option's button; wins over the component-level fallback. */
  testId?: string;
}

export interface SegmentedToggleProps<T extends string> {
  options: ReadonlyArray<SegmentedOption<T>>;
  value: T;
  onChange: (value: T) => void;
  size?: 'sm' | 'md';
  /** `pill` = white card active state; `filled` = solid navy active (view switches). */
  variant?: 'pill' | 'filled';
  ariaLabel: string;
  className?: string;
  /** When set, options without their own `testId` fall back to `${data-testid}-${opt.value}`. */
  'data-testid'?: string;
}

/** Pick-one segmented control — replaces the per-surface scope / view toggles. */
export function SegmentedToggle<T extends string>({
  options,
  value,
  onChange,
  size = 'md',
  variant = 'pill',
  ariaLabel,
  className,
  'data-testid': testId,
}: SegmentedToggleProps<T>) {
  const classes = [
    'kp-segmented',
    `kp-segmented--${size}`,
    `kp-segmented--${variant}`,
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <div className={classes} role="group" aria-label={ariaLabel}>
      {options.map((opt) => {
        const Icon = opt.icon;
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            className={`kp-segmented__item${active ? ' is-active' : ''}`}
            aria-pressed={active}
            data-testid={opt.testId ?? (testId ? `${testId}-${opt.value}` : undefined)}
            onClick={() => {
              onChange(opt.value);
            }}
          >
            {Icon ? <Icon size={12} strokeWidth={1.75} /> : null}
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
