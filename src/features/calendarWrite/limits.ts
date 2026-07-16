/**
 * V1 provider write limits (SC-013, SC-014, SC-022) — ENFORCED, not displayed.
 *
 * v1 permits exactly one shape of write: an advisor-owned, one-time event on the
 * single home/write calendar. Everything else is refused here, before any port
 * or egress call happens. Many of the forbidden operations (delete,
 * cross-calendar move, guest-list mutation, recurring-series edit) are already
 * unrepresentable in `CalendarWriteIntent` — there is no delete intent, no
 * attendee field, and an update pins a single target. This module is the runtime
 * half of that guarantee: the checks that a well-typed intent can still fail.
 *
 * Fail closed: an intent that does not positively satisfy every rule is refused
 * with a fixed reason code, never allowed through on a missing check.
 */
import type {
  CalendarWriteIntent,
  CalendarWriteRefusalReason,
} from './types';

export interface WriteLimitContext {
  /** The single calendar a new booking may land on (SC-013). */
  readonly homeCalendarId: string;
}

export type WriteLimitResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: CalendarWriteRefusalReason };

function refuse(reason: CalendarWriteRefusalReason): WriteLimitResult {
  return { ok: false, reason };
}

/**
 * Apply the v1 write limits to an intent. Returns `ok` only when the intent is
 * an advisor-owned one-time event on the home calendar; otherwise a refusal with
 * the specific reason.
 *
 * The provider is already narrowed to a write-capable one by the type
 * (`CalendarWriteProviderId` excludes ICS); the orchestrator additionally
 * refuses any provider without a registered adapter before it reaches here, so a
 * provider check would be dead code.
 */
export function enforceWriteLimits(
  intent: CalendarWriteIntent,
  ctx: WriteLimitContext,
): WriteLimitResult {
  // SC-013: a new booking only ever lands on the single home/write calendar.
  if (!ctx.homeCalendarId || intent.targetCalendarId !== ctx.homeCalendarId) {
    return refuse('wrong_calendar');
  }

  if (intent.kind === 'update') {
    const { target } = intent;

    // SC-013 / B4: a reschedule must STAY in the same permitted (home) calendar.
    // Both the event being rescheduled and the destination must be the home
    // calendar; anything else is a cross-calendar move, which v1 forbids.
    if (target.providerCalendarId !== ctx.homeCalendarId) {
      return refuse('wrong_calendar');
    }

    // v1 mutates a one-time event only. Any recurring shape is refused here so
    // the refusal is explicit, not an accident of a missing branch.
    if (target.seriesKind !== 'single') {
      return refuse('series_unsupported');
    }

    // SC-014: the target must be advisor-owned...
    if (target.ownership !== 'organizer-self') {
      return refuse('not_owned');
    }

    // ...AND the provider's own capability must say it is writeable. A
    // `Calendars.ReadWrite.Shared`-style reach into an unowned calendar comes
    // back with canWrite=false and is refused.
    if (!target.canWrite) {
      return refuse('not_writeable');
    }
  }

  return { ok: true };
}
