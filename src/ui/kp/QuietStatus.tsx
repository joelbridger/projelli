import type { HTMLAttributes, ReactNode } from 'react';
import { Check, AlertTriangle } from 'lucide-react';
import type { IconType } from './types';

/**
 * QuietStatus — normal-good states, said quietly (synthesis theme 6).
 *
 * Empty, normal, and success states take too much space across the app: saved
 * badges, "reviewed" pills, ready cards, "no new changes". QuietStatus makes the
 * NORMAL case small (a muted tick + short text, or NOTHING when there is nothing
 * useful to say) and only gets LOUD when the caller explicitly passes
 * `state="failure"` — because failures and blockers must stay visible.
 *
 * This is the inverse of the usual status pattern: the good state is the quiet
 * one. Callers pass the loud state deliberately; they never get a shouting
 * "Saved!" for free.
 *
 *   <QuietStatus>Saved</QuietStatus>                     // muted tick + "Saved"
 *   <QuietStatus state="ok" />                            // nothing (truly quiet)
 *   <QuietStatus state="failure">Couldn't save</QuietStatus>  // loud, red, alert
 *
 * Forwards DOM props (data-testid, aria-*, id) onto the root span.
 */

export type QuietStatusState = 'ok' | 'pending' | 'failure';

const DEFAULT_ICON: Record<QuietStatusState, IconType | undefined> = {
  ok: Check,
  pending: undefined,
  failure: AlertTriangle,
};

export interface QuietStatusProps
  extends Omit<HTMLAttributes<HTMLSpanElement>, 'className'> {
  /** Short status text. Omit in the `ok` state to render nothing at all. */
  children?: ReactNode;
  /** `ok` (quiet, default), `pending` (quiet), `failure` (loud, red, alert). */
  state?: QuietStatusState;
  /** Override the per-state icon. */
  icon?: IconType;
  className?: string;
}

export function QuietStatus({
  children,
  state = 'ok',
  icon,
  className,
  ...rest
}: QuietStatusProps) {
  // Truly quiet: a normal-good state with nothing to say renders nothing.
  if (state === 'ok' && children == null) return null;

  const Icon = icon === undefined ? DEFAULT_ICON[state] : icon;
  const classes = ['kp-quietstatus', `kp-quietstatus--${state}`, className ?? '']
    .filter(Boolean)
    .join(' ');
  return (
    <span
      className={classes}
      role={state === 'failure' ? 'alert' : 'status'}
      {...rest}
    >
      {Icon ? (
        <span className="kp-quietstatus__icon">
          <Icon size={13} strokeWidth={1.75} aria-hidden />
        </span>
      ) : null}
      {children != null ? <span className="kp-quietstatus__text">{children}</span> : null}
    </span>
  );
}
