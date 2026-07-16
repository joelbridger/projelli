/**
 * Calendar write-consent contract — types only.
 *
 * Two structural rules make a leak impossible rather than merely discouraged:
 *
 * 1. No secret is representable here. A newly issued grant is referenced by an
 *    opaque `StagedGrantRef` that the native layer holds; the token, the
 *    consent URL, the PKCE verifier, and the client id never cross into the
 *    renderer, so no amount of logging or receipt-building can spill one.
 * 2. A failure is a closed enum, never provider error text. Provider errors
 *    routinely echo the consent URL (which carries client_id, state, and the
 *    code challenge), so the reason is mapped to a fixed code at the port
 *    boundary and the original string is dropped.
 *
 * Rule 2 is a claim about a value, not about a shape, and every type in this
 * file is erased before that value arrives. What makes it true is
 * `portBoundary.ts`, which validates each field of a port response at runtime.
 * A type here describes what a CONFORMING port sends; it does not constrain a
 * non-conforming one. Do not read a promise in this file as a check.
 */
import type { CalendarProviderId } from '../types';

/**
 * Providers that can ever hold a write grant. ICS is deliberately absent: it is
 * a read-only feed and SC-022 keeps it that way.
 */
export type CalendarWriteProviderId = Exclude<CalendarProviderId, 'ics'>;

export type CalendarGrantCapability = 'read' | 'write';

/**
 * What a stored provider grant is allowed to do. `capability` is derived from
 * the scopes the provider said it granted — never from the scopes we asked for.
 */
export interface CalendarGrant {
  readonly provider: CalendarWriteProviderId;
  readonly capability: CalendarGrantCapability;
  /** Recognized granted scope tokens only; unrecognized values are dropped. */
  readonly grantedScopes: readonly string[];
  /** Increments on every verified re-grant, so a stale write claim is visible. */
  readonly grantVersion: number;
}

/**
 * Closed set. Provider error text never reaches a receipt or a log — enforced at
 * runtime by `coerceFailureReason`, which is what closes this set in practice.
 */
export type CalendarConsentFailureReason =
  | 'network_unavailable'
  | 'provider_rejected'
  | 'timeout'
  | 'cancelled'
  | 'internal';

/** Opaque handle to a grant the native layer has staged but not committed. */
export type StagedGrantRef = string & { readonly __brand: 'StagedGrantRef' };

/**
 * What a conforming port sends back. Untrusted: pass it through
 * `verifyConsentAttempt` before reading any field. Nothing may consume this
 * shape directly.
 */
export type CalendarConsentAttempt =
  | {
      readonly outcome: 'granted';
      /** Exactly what the provider reported granting. Treated as untrusted. */
      readonly grantedScopes: readonly string[];
      readonly stagedRef: StagedGrantRef;
    }
  | { readonly outcome: 'denied' }
  | { readonly outcome: 'failed'; readonly reason: CalendarConsentFailureReason };

/**
 * The seam the native layer implements. Staging is separate from committing so
 * a grant that fails scope verification is discarded with the old read grant
 * still in force.
 */
export interface CalendarConsentPort {
  requestWriteConsent(
    provider: CalendarWriteProviderId,
    requestedScopes: readonly string[],
  ): Promise<CalendarConsentAttempt>;
  /** Promote the staged grant to the stored grant for this provider. */
  commitStagedGrant(ref: StagedGrantRef): Promise<void>;
  /** Drop the staged grant; the previously stored grant remains in force. */
  discardStagedGrant(ref: StagedGrantRef): Promise<void>;
}

export type CalendarWriteConsentOutcome =
  /** Provider verified write scope; the stored grant is now write-capable. */
  | 'upgraded'
  /** The person declined at the provider. Old read grant untouched. */
  | 'denied'
  /** A grant came back without write scope (e.g. the box was unchecked). */
  | 'insufficient_scope'
  /** The attempt errored. Old read grant untouched. */
  | 'failed'
  /** ICS, or any provider that may never hold a write grant. */
  | 'unsupported_provider'
  /** Nothing to upgrade: write consent is an upgrade, never a first connect. */
  | 'no_existing_read_grant'
  /** Already write-capable; no consent request was made. */
  | 'already_write';

/**
 * The auditable record of one consent attempt. Every field is either a fixed
 * code or a recognized scope token, so this shape is safe to persist and show.
 */
export interface CalendarWriteConsentReceipt {
  readonly provider: CalendarProviderId;
  readonly outcome: CalendarWriteConsentOutcome;
  readonly capabilityAfter: CalendarGrantCapability;
  readonly grantVersionAfter: number;
  readonly recognizedScopes: readonly string[];
  readonly reason?: CalendarConsentFailureReason;
}

export interface CalendarWriteConsentResult {
  /** The grant in force AFTER the attempt. Unchanged unless outcome is 'upgraded'. */
  readonly grant: CalendarGrant | null;
  readonly receipt: CalendarWriteConsentReceipt;
}

export interface CalendarWriteConsentInput {
  readonly provider: CalendarProviderId;
  readonly currentGrant: CalendarGrant | null;
  readonly port: CalendarConsentPort;
}
