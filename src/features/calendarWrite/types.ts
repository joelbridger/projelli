/**
 * Part B calendar-write contract — types only.
 *
 * Three invariants shape every type here, and they are the ones the independent
 * review checks:
 *
 * 1. **No secret is representable.** A token, refresh token, consent URL, PKCE
 *    verifier, client id, or provider error string cannot be a field of any
 *    proposal, receipt, or stored record. Failures are closed enums; provider
 *    identity is an opaque event/calendar id and an ETag string.
 * 2. **A confirmation is only ever a verified provider receipt.** A slot, a
 *    locally "approved" proposal, or a staged intent is never a confirmation.
 *    The types keep those states distinct so a caller cannot mistake one for the
 *    other.
 * 3. **Write is derived, never assumed.** Write eligibility comes from a fully
 *    versioned read projection whose facts were verified under a known grant
 *    version. A legacy row lacking those facts is `view-only`, structurally.
 */
import type { CalendarWriteProviderId } from '@/platform/calendar/writeConsent';

export type { CalendarWriteProviderId };

// ── Versioned read model (B1) ──────────────────────────────────────────────

/**
 * How an event sits in a recurring series. Only a standalone one-time event is
 * ever write-eligible in v1 (SC-013/SC-014); every recurring shape is carried so
 * the limit can refuse it explicitly rather than by omission.
 */
export type CalendarSeriesKind =
  | 'single'
  | 'recurring-master'
  | 'recurring-instance'
  | 'recurring-exception';

/**
 * Who owns the event on the provider side. Only an event the advisor organizes
 * on their own calendar may be written (SC-014); an invite the advisor merely
 * attends is never write-eligible.
 */
export type CalendarEventOwnership = 'organizer-self' | 'attendee' | 'unknown';

/**
 * The provider-side facts a write must stand on. Every field is required: a read
 * projection that cannot supply all of them is not versioned, and an unversioned
 * row is view-only.
 */
export interface VersionedProviderProjection {
  readonly provider: CalendarWriteProviderId;
  /** Opaque provider event id. Never a secret; safe to persist and show. */
  readonly providerEventId: string;
  readonly providerCalendarId: string;
  /** Provider ETag / change-key. The staleness anchor for every write. */
  readonly providerVersion: string;
  readonly ownership: CalendarEventOwnership;
  /** The provider's own can-write answer for THIS event. */
  readonly canWrite: boolean;
  readonly seriesKind: CalendarSeriesKind;
  readonly originalTimezone: string;
  readonly location: string | null;
  /** The grant version this read was verified under, so a write cannot ride an
   *  older read than the grant that authorises it. */
  readonly readGrantVersion: number;
}

export type ViewOnlyReason =
  | 'legacy-unversioned'
  | 'malformed-projection'
  | 'unsupported-provider';

/**
 * A read row is either write-eligible (fully versioned) or view-only. There is
 * no third state; a caller that has a `writeable` value holds every fact a write
 * needs, and a `view-only` value can never be coerced into one.
 */
export type CalendarWriteEligibility =
  | { readonly kind: 'writeable'; readonly projection: VersionedProviderProjection }
  | { readonly kind: 'view-only'; readonly reason: ViewOnlyReason };

// ── Write intent, proposal, receipt (B2–B6) ────────────────────────────────

/** Create a brand-new one-time event, or reschedule an advisor-owned one. */
export type CalendarWriteIntentKind = 'create' | 'update';

/**
 * The event content a write carries. Deliberately the minimum for a one-time
 * booking. No attendee/guest-list field: guest-list mutation is out of v1
 * (SC-013), so it is not representable here.
 */
export interface CalendarWriteEventInput {
  readonly title: string;
  readonly startUtc: string;
  readonly endUtc: string;
  readonly displayTimezone: string;
  readonly allDay: boolean;
  readonly location: string | null;
  readonly notes: string | null;
}

/**
 * A create intent — a new advisor-owned one-time event on the home/write
 * calendar. No `target`: there is nothing to reschedule.
 */
export interface CalendarCreateIntent {
  readonly kind: 'create';
  readonly provider: CalendarWriteProviderId;
  readonly targetCalendarId: string;
  readonly event: CalendarWriteEventInput;
}

/**
 * An update intent — a reschedule of one advisor-owned one-time event that stays
 * in the same permitted calendar (SC-013). The `target` pins the exact provider
 * event and the version the reschedule was decided against.
 */
export interface CalendarUpdateIntent {
  readonly kind: 'update';
  readonly provider: CalendarWriteProviderId;
  readonly targetCalendarId: string;
  readonly event: CalendarWriteEventInput;
  readonly target: {
    readonly providerEventId: string;
    readonly providerCalendarId: string;
    readonly expectedVersion: string;
    readonly seriesKind: CalendarSeriesKind;
    readonly ownership: CalendarEventOwnership;
    readonly canWrite: boolean;
  };
}

export type CalendarWriteIntent = CalendarCreateIntent | CalendarUpdateIntent;

/**
 * Why a write may never proceed. A closed set: provider error text — which
 * routinely embeds the consent URL and its client id/state/PKCE challenge — is
 * mapped to one of these codes and dropped, exactly as the consent contract
 * does. No free-text field exists on a receipt for it to ride in on.
 */
export type CalendarWriteRefusalReason =
  | 'consent_missing' // no write grant / read-only connection
  | 'flag_disabled' // the write surface is dark
  | 'not_writeable' // provider capability says read-only for this event
  | 'not_owned' // not organiser-self
  | 'wrong_calendar' // target is not the single home/write calendar
  | 'series_unsupported' // recurring / instance / exception
  | 'slot_unavailable' // a busy block newly overlaps at pre-approval refresh
  | 'stale_version' // the provider event moved under us
  | 'unsupported_operation' // delete / move / guest edit / ICS write
  | 'provider_unsupported'; // ICS or any non-write provider

/**
 * Why a submitted write could not be turned into a confirmation. Distinct from a
 * refusal (which happens before any egress): these are outcomes of an attempt.
 */
export type CalendarWriteFailureReason =
  | 'network_unavailable'
  | 'provider_rejected'
  | 'timeout'
  | 'conflict'
  | 'internal';

export type CalendarWriteProposalStatus =
  /** Prepared and encrypted locally. NO egress has happened. Not a confirmation. */
  | 'prepared'
  /** Approved and submitted; awaiting the verified provider receipt. */
  | 'approved'
  /** Submitted, but the outcome is ambiguous (e.g. a timeout). Must be resolved
   *  by verification, never blindly re-fired. */
  | 'verify_pending'
  /** A verified provider receipt exists. The ONLY status that confirms. */
  | 'verified'
  /** Refused before egress, or failed after; terminal, no confirmation. */
  | 'refused'
  | 'failed';

/**
 * The auditable, persist-safe record of one write. Every field is a fixed code,
 * an opaque id, an ETag, or advisor-authored event text — never a secret.
 */
export interface CalendarWriteProposal {
  readonly id: string;
  readonly kind: CalendarWriteIntentKind;
  readonly provider: CalendarWriteProviderId;
  readonly targetCalendarId: string;
  readonly status: CalendarWriteProposalStatus;
  /** Stable across retries; the same key is presented to the provider so a
   *  retried submit reconciles instead of duplicating. */
  readonly idempotencyKey: string;
  readonly event: CalendarWriteEventInput;
  /** Present for an update: the versioned target the reschedule was decided on. */
  readonly target?: CalendarUpdateIntent['target'];
  /** The grant version in force when the proposal was prepared. */
  readonly grantVersion: number;
  readonly createdAtUtc: string;
  readonly updatedAtUtc: string;
  /** Present only once verified: the provider's confirmed identity for the event. */
  readonly confirmed?: {
    readonly providerEventId: string;
    readonly providerVersion: string;
    readonly verifiedAtUtc: string;
  };
  readonly refusalReason?: CalendarWriteRefusalReason;
  readonly failureReason?: CalendarWriteFailureReason;
}

/**
 * The result of an orchestration step. A `confirmed` outcome is the ONLY shape
 * that carries a booking confirmation, and it is reachable only from a verified
 * provider receipt (B3/SC-012).
 */
export type CalendarWriteOutcome =
  | { readonly kind: 'prepared'; readonly proposal: CalendarWriteProposal }
  | { readonly kind: 'confirmed'; readonly proposal: CalendarWriteProposal }
  | { readonly kind: 'verify_pending'; readonly proposal: CalendarWriteProposal }
  | {
      readonly kind: 'refused';
      readonly reason: CalendarWriteRefusalReason;
      readonly proposal?: CalendarWriteProposal;
    }
  | {
      readonly kind: 'failed';
      readonly reason: CalendarWriteFailureReason;
      readonly proposal: CalendarWriteProposal;
    };
