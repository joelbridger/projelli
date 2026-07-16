/**
 * The port boundary — where an untrusted native response becomes trusted values.
 *
 * `CalendarConsentPort` is a promise the port makes in TypeScript, and
 * TypeScript is erased at runtime. The native port does not exist yet: the first
 * one written will be checked here or by nothing at all. So `types.ts` can only
 * claim a failure reason is a closed enum, or that no secret is representable,
 * if something validates that claim when the value actually arrives. This module
 * is that something.
 *
 * Two rules, and every field of a port response obeys both:
 *
 * 1. **Validated, not merely typed.** An unrecognized value is replaced with a
 *    safe one, never carried. A string the contract never defined must not reach
 *    a receipt just because a `.d.ts` said it could not exist.
 * 2. **Read exactly once.** A response is untrusted input, not a stable value —
 *    a field read twice can answer differently each time. Everything downstream
 *    derives from the snapshot taken here, so a capability and the scopes that
 *    justify it are provably the same evidence.
 *
 * Anything unclear fails closed: to `read`, or to `failed`/`internal`. Nothing
 * here can widen a capability.
 */
import { capabilityOfRecognizedScopes, normalizeGrantedScopes } from './scopeEvaluation';
import type {
  CalendarConsentFailureReason,
  CalendarGrantCapability,
  CalendarWriteProviderId,
  StagedGrantRef,
} from './types';

/**
 * A port response after validation. Unlike `CalendarConsentAttempt` — which
 * describes what a *conforming* port would send — every value here has been
 * checked at runtime, and the scopes and the capability come from one read.
 */
export type VerifiedConsentAttempt =
  | {
      readonly outcome: 'granted';
      readonly capability: CalendarGrantCapability;
      readonly recognizedScopes: readonly string[];
      readonly stagedRef: StagedGrantRef;
    }
  | { readonly outcome: 'denied' }
  | { readonly outcome: 'failed'; readonly reason: CalendarConsentFailureReason };

const FAILURE_REASONS: ReadonlySet<string> = new Set<CalendarConsentFailureReason>([
  'network_unavailable',
  'provider_rejected',
  'timeout',
  'cancelled',
  'internal',
]);

/**
 * Reduce anything a port offers as a failure reason to a code the contract
 * defined. Unknown becomes `'internal'`: a provider error string routinely
 * embeds the consent URL, and with it the client id, the state, and the PKCE
 * challenge, so it must be dropped rather than mapped to something friendlier.
 *
 * Exported so the native lane maps its errors with this instead of restating it.
 */
export function coerceFailureReason(reason: unknown): CalendarConsentFailureReason {
  return typeof reason === 'string' && FAILURE_REASONS.has(reason)
    ? (reason as CalendarConsentFailureReason)
    : 'internal';
}

/**
 * Validate one raw port response. Takes `unknown` on purpose: the whole point is
 * that the declared type proves nothing about the value that arrives.
 *
 * Exported so the native lane verifies its own responses against the same rules
 * its callers will.
 */
export function verifyConsentAttempt(
  provider: CalendarWriteProviderId,
  response: unknown,
): VerifiedConsentAttempt {
  const raw = response as
    | {
        outcome?: unknown;
        reason?: unknown;
        stagedRef?: unknown;
        grantedScopes?: unknown;
      }
    | null
    | undefined;
  const outcome = raw?.outcome;

  if (outcome === 'denied') {
    return { outcome: 'denied' };
  }
  if (outcome === 'failed') {
    return { outcome: 'failed', reason: coerceFailureReason(raw?.reason) };
  }
  if (outcome !== 'granted') {
    // An outcome the contract never defined. Reading on would treat it as a
    // grant, so stop here: unclear means no capability.
    return { outcome: 'failed', reason: 'internal' };
  }

  const stagedRef = raw?.stagedRef;
  if (typeof stagedRef !== 'string' || stagedRef.length === 0) {
    // A grant with no handle can be neither committed nor discarded, so there is
    // nothing to verify and nothing to clean up.
    return { outcome: 'failed', reason: 'internal' };
  }

  // Read once, normalize once, and derive the capability from that one array —
  // never from a second read of the response.
  const recognizedScopes = normalizeGrantedScopes(provider, coerceScopeTokens(raw?.grantedScopes));
  return {
    outcome: 'granted',
    capability: capabilityOfRecognizedScopes(provider, recognizedScopes),
    recognizedScopes,
    stagedRef: stagedRef as StagedGrantRef,
  };
}

/**
 * Accept the space-delimited string providers actually return, or an array of
 * tokens, and nothing else. A non-string token is dropped rather than allowed to
 * throw out of normalization; an unusable value becomes no scopes at all, which
 * reads as `read`.
 */
function coerceScopeTokens(granted: unknown): readonly string[] | string {
  if (typeof granted === 'string') return granted;
  if (!Array.isArray(granted)) return [];
  return granted.filter((token): token is string => typeof token === 'string');
}
