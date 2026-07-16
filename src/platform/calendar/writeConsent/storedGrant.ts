/**
 * The stored-grant boundary — where a grant loaded from storage becomes trusted.
 *
 * The OAuth write-consent review (§6) left one obligation open on purpose:
 * nothing persisted a `CalendarGrant` yet, so `requestCalendarWriteConsent`
 * trusted an in-memory `currentGrant.capability` it had just derived itself. The
 * day a grant arrives from storage that stops being safe. A persisted record is
 * the same untrusted-value class a port response is: its `capability` field is a
 * claim, and a claim about write access is exactly the thing an attacker (or a
 * corrupt/rolled-back store) would flip.
 *
 * So a stored grant is never believed. This module re-derives the capability
 * from the persisted **scopes** using the one exported rule
 * (`capabilityOfRecognizedScopes`), and any disagreement with the stored
 * `capability` claim demotes to `read`. A grant can only ever become
 * write-capable again by going back through `requestCalendarWriteConsent`, which
 * verifies the provider's grant afresh. Loading can lose write; it can never
 * grant it.
 */
import {
  capabilityOfRecognizedScopes,
  normalizeGrantedScopes,
} from './scopeEvaluation';
import type {
  CalendarGrant,
  CalendarGrantCapability,
  CalendarWriteProviderId,
} from './types';

function isWriteCapableProvider(value: unknown): value is CalendarWriteProviderId {
  // ICS and any unknown provider can never hold a grant. Answered structurally
  // so a stored record claiming `ics` cannot round-trip into a usable grant.
  return value === 'outlook' || value === 'google';
}

/**
 * Accept the space-delimited string a provider returns, or an array of tokens,
 * and nothing else. Anything unusable becomes no scopes at all, which reads as
 * `read`. Mirrors the port-boundary coercion so a stored response and a live
 * response fail closed identically.
 */
function coerceScopeTokens(granted: unknown): readonly string[] | string {
  if (typeof granted === 'string') return granted;
  if (!Array.isArray(granted)) return [];
  return granted.filter((token): token is string => typeof token === 'string');
}

/**
 * Validate one grant loaded from storage. Takes `unknown` on purpose: a `.d.ts`
 * describing what a conforming record looks like proves nothing about the bytes
 * that actually came back from disk.
 *
 * Returns the trusted grant, or `null` when the record cannot be trusted to hold
 * any grant at all (wrong provider, unusable version). A record whose scopes are
 * read-only — or whose `capability` claim disagrees with what its scopes justify
 * — comes back as a **read** grant, never a write one.
 *
 * Callers must pass the result of this function, not the raw stored record, to
 * anything that gates a write (`assertCalendarWriteAllowed`,
 * `requestCalendarWriteConsent`).
 */
export function verifyStoredGrant(stored: unknown): CalendarGrant | null {
  if (!stored || typeof stored !== 'object') return null;
  const raw = stored as {
    provider?: unknown;
    capability?: unknown;
    grantedScopes?: unknown;
    grantVersion?: unknown;
  };

  const { provider } = raw;
  if (!isWriteCapableProvider(provider)) return null;

  // The version is what makes a stale write visible. If it is not a finite
  // non-negative integer we cannot reason about staleness at all, so there is no
  // grant to hand out — fail closed rather than invent a version.
  const grantVersion = raw.grantVersion;
  if (
    typeof grantVersion !== 'number' ||
    !Number.isInteger(grantVersion) ||
    grantVersion < 0
  ) {
    return null;
  }

  // Re-derive capability from the PERSISTED scopes — never from the stored
  // `capability` field. Unrecognized scope tokens are dropped by normalization,
  // so a record cannot smuggle a write capability in through a scope string the
  // contract does not recognize.
  const grantedScopes = normalizeGrantedScopes(
    provider,
    coerceScopeTokens(raw.grantedScopes),
  );
  const derived = capabilityOfRecognizedScopes(provider, grantedScopes);

  // Any disagreement between the stored claim and the scopes demotes to read.
  // This catches the F1/F2 class exactly: a record whose `capability` says
  // `write` but whose scopes are read-only (a flipped field, a partial write,
  // a rolled-back store) can never re-enter as a write grant. A record that
  // claims `read` while carrying a write scope is not silently promoted either;
  // write is only ever minted by a fresh verified consent.
  const claimed: CalendarGrantCapability | undefined =
    raw.capability === 'write' || raw.capability === 'read'
      ? raw.capability
      : undefined;
  const capability: CalendarGrantCapability =
    claimed === derived ? derived : 'read';

  return { provider, capability, grantedScopes, grantVersion };
}
