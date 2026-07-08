import type { HTMLAttributes, ReactNode } from 'react';
import { Info, AlertTriangle, ShieldAlert } from 'lucide-react';
import type { IconType } from './types';

/**
 * TrustNote — trust-ladder LEVEL 2: "one short line at action time".
 *
 * The trust ladder (synthesis theme 4) has three rungs:
 *   1. always visible — a tiny status (e.g. the top-bar egress pill);
 *   2. AT ACTION TIME — ONE short sentence next to the button that does the
 *      risky thing (this component): "Review first. Sends by your email.";
 *   3. on demand — the full paragraph, in a tooltip / Privacy Center / dialog.
 *
 * TrustNote is rung 2. It is QUIET by default: muted text, an inline icon, no
 * border and no card — a single line, never a reassurance box (that is what
 * Callout is for). The louder `warning` (amber) and `blocker` (red) variants
 * exist ONLY for genuine risk states the caller opts into; normal trust copy
 * stays the muted default. The long explanation, when there is one, lives in
 * `details` and surfaces on hover/focus (rung 3) so the line itself stays short.
 *
 * It forwards DOM props (data-testid, aria-*, id) onto the root span.
 */

export type TrustNoteVariant = 'default' | 'warning' | 'blocker';

const DEFAULT_ICON: Record<TrustNoteVariant, IconType> = {
  default: Info,
  warning: AlertTriangle,
  blocker: ShieldAlert,
};

export interface TrustNoteProps
  extends Omit<HTMLAttributes<HTMLSpanElement>, 'className' | 'title'> {
  /** The one short sentence shown at action time. */
  children: ReactNode;
  /** Quiet muted default; `warning` = amber, `blocker` = red. */
  variant?: TrustNoteVariant;
  /** Override the per-variant leading icon. */
  icon?: IconType;
  /**
   * The full "on demand" explanation (rung 3). When set, a small info glyph is
   * shown and the text is exposed as the line's native tooltip, so the visible
   * sentence stays short.
   */
  details?: string;
  className?: string;
}

export function TrustNote({
  children,
  variant = 'default',
  icon,
  details,
  className,
  ...rest
}: TrustNoteProps) {
  const Icon = icon ?? DEFAULT_ICON[variant];
  const classes = ['kp-trustnote', `kp-trustnote--${variant}`, className ?? '']
    .filter(Boolean)
    .join(' ');
  return (
    <span
      className={classes}
      role={variant === 'blocker' ? 'alert' : undefined}
      {...(details ? { title: details } : {})}
      {...rest}
    >
      <span className="kp-trustnote__icon">
        <Icon size={14} strokeWidth={1.75} aria-hidden />
      </span>
      <span className="kp-trustnote__text">{children}</span>
      {details ? (
        <Info className="kp-trustnote__more" size={12} strokeWidth={1.75} aria-hidden />
      ) : null}
    </span>
  );
}
