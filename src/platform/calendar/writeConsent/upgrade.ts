/**
 * The write-consent upgrade — the only path from a read grant to a write grant.
 *
 * Shape of the guarantee: a new grant is staged by the native layer, verified
 * here against what the provider said it granted, and only then committed. Any
 * other ending discards the staged grant and leaves the working read grant
 * exactly as it was. A person who declines, unticks the write box, or loses
 * their network still has the calendar connection they had before.
 */
import { verifyConsentAttempt, type VerifiedConsentAttempt } from './portBoundary';
import { writeConsentScopeRequest } from './scopeEvaluation';
import type {
  CalendarGrant,
  CalendarGrantCapability,
  CalendarWriteConsentInput,
  CalendarWriteConsentOutcome,
  CalendarWriteConsentReceipt,
  CalendarWriteConsentResult,
  CalendarConsentFailureReason,
} from './types';
import type { CalendarProviderId } from '../types';

export async function requestCalendarWriteConsent(
  input: CalendarWriteConsentInput,
): Promise<CalendarWriteConsentResult> {
  const { provider, currentGrant, port } = input;

  // SC-022: an ICS feed is a read-only subscription and can never hold a write
  // grant. Answered before any port call, so a dark or mistaken caller makes no
  // network request at all.
  if (!isWriteCapableProvider(provider)) {
    return settle(currentGrant, provider, 'unsupported_provider');
  }

  if (!currentGrant) {
    // Write consent is an upgrade, never the door in. A first connect stays
    // read-only, which keeps the existing connect flow untouched and means a
    // person always sees read work before being asked for write.
    return settle(null, provider, 'no_existing_read_grant');
  }

  if (currentGrant.provider !== provider) {
    // A caller pairing one provider's grant with another provider's request is
    // a programming error, and continuing could commit a grant against the
    // wrong account. Message carries no grant detail.
    throw new Error('calendar write consent: grant does not belong to the requested provider');
  }

  if (currentGrant.capability === 'write') {
    return settle(currentGrant, provider, 'already_write');
  }

  let attempt: VerifiedConsentAttempt;
  try {
    const response = await port.requestWriteConsent(provider, writeConsentScopeRequest(provider));
    // Validated here and never re-read: past this line nothing in this function
    // touches the port's response, so no field of it can shift underneath us.
    attempt = verifyConsentAttempt(provider, response);
  } catch {
    // The thrown value is dropped, never inspected or forwarded: provider and
    // transport errors routinely embed the consent URL, which carries the
    // client id, the state, and the PKCE challenge.
    return settle(currentGrant, provider, 'failed', 'internal');
  }

  if (attempt.outcome === 'denied') {
    return settle(currentGrant, provider, 'denied');
  }
  if (attempt.outcome === 'failed') {
    // Already coerced to a code the contract defined; provider text cannot ride
    // in on this field.
    return settle(currentGrant, provider, 'failed', attempt.reason);
  }

  if (attempt.capability !== 'write') {
    // Sign-in completed but write was not actually granted. Drop it: replacing
    // a proven read grant with an unproven one would risk trading a working
    // connection for a narrower one.
    await discardQuietly(port, attempt.stagedRef);
    return settle(
      currentGrant,
      provider,
      'insufficient_scope',
      undefined,
      attempt.recognizedScopes,
    );
  }

  try {
    await port.commitStagedGrant(attempt.stagedRef);
  } catch {
    // Verified, but the store did not confirm. The grant may or may not have
    // landed, so we must not claim write; a later reconnect can retry safely.
    return settle(currentGrant, provider, 'failed', 'internal');
  }

  const upgraded: CalendarGrant = {
    provider,
    capability: 'write',
    // The same array the capability was derived from, so the grant's scopes
    // always justify the grant's capability.
    grantedScopes: attempt.recognizedScopes,
    grantVersion: currentGrant.grantVersion + 1,
  };
  return settle(upgraded, provider, 'upgraded', undefined, attempt.recognizedScopes);
}

/**
 * The gate every provider writer must pass before touching a calendar. A grant
 * whose capability was not verified as write cannot be written through, so a
 * missing check fails loudly rather than silently attempting the write.
 */
export function assertCalendarWriteAllowed(grant: CalendarGrant | null): void {
  if (!grant) {
    throw new Error('calendar write blocked: no calendar grant is connected');
  }
  if (grant.capability !== 'write') {
    throw new Error(
      'calendar write blocked: this connection is read-only until write access is approved',
    );
  }
}

function isWriteCapableProvider(
  provider: CalendarProviderId,
): provider is Exclude<CalendarProviderId, 'ics'> {
  return provider === 'outlook' || provider === 'google';
}

async function discardQuietly(
  port: CalendarWriteConsentInput['port'],
  ref: Parameters<CalendarWriteConsentInput['port']['discardStagedGrant']>[0],
): Promise<void> {
  try {
    await port.discardStagedGrant(ref);
    // eslint-disable-next-line lantern-async/no-silent-failure -- Genuine best effort: a staged grant that outlives this call is inert (it is not the stored grant, so nothing can write through it), and the caller's outcome must reflect the consent result, not a cleanup failure.
  } catch {
    // Intentionally ignored; see the disable reason above.
  }
}

/**
 * Build the result and its receipt from the grant that is actually in force.
 * Deriving both from one grant is what keeps a receipt from ever claiming a
 * capability the stored grant does not have.
 */
function settle(
  grant: CalendarGrant | null,
  provider: CalendarProviderId,
  outcome: CalendarWriteConsentOutcome,
  reason?: CalendarConsentFailureReason,
  recognizedScopes: readonly string[] = [],
): CalendarWriteConsentResult {
  const capabilityAfter: CalendarGrantCapability = grant?.capability ?? 'read';
  const receipt: CalendarWriteConsentReceipt = {
    provider,
    outcome,
    capabilityAfter,
    grantVersionAfter: grant?.grantVersion ?? 0,
    recognizedScopes,
    ...(reason ? { reason } : {}),
  };
  return { grant, receipt };
}
