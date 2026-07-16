/**
 * Scope evaluation — the one place that decides whether a provider grant may
 * write.
 *
 * The rule that matters: capability is derived from the scopes the provider
 * said it GRANTED, never from the scopes we asked for. Both Microsoft and
 * Google can hand back less than was requested — Google's consent screen lets
 * a person untick individual permissions — so a grant that was requested as
 * write can arrive read-only. Trusting the request would hand out a write
 * capability the provider never issued, and the first write would fail at the
 * API with the person already told their calendar was connected for writing.
 *
 * Everything here fails closed: unrecognized, absent, or unparseable scopes
 * mean read.
 */
import type { CalendarGrantCapability, CalendarWriteProviderId } from './types';

/** Microsoft echoes scopes either bare or prefixed with the Graph resource. */
const GRAPH_RESOURCE_PREFIX = 'https://graph.microsoft.com/';

const GOOGLE_AUTH = 'https://www.googleapis.com/auth/';

/**
 * The exact scope that grants event write, per provider.
 *
 * Outlook uses `Calendars.ReadWrite` (own calendars) and deliberately NOT
 * `Calendars.ReadWrite.Shared`, which would reach calendars the advisor does
 * not own — SC-014 says writes cover own calendars only.
 *
 * Google uses `calendar.events`, the least privilege that can create or update
 * an event, and deliberately NOT the full `calendar` scope, which would also
 * let us create and delete whole calendars.
 */
const WRITE_SCOPE: Record<CalendarWriteProviderId, string> = {
  outlook: 'Calendars.ReadWrite',
  google: `${GOOGLE_AUTH}calendar.events`,
};

/**
 * Scope tokens we will carry into a grant or a receipt. Anything outside this
 * list is dropped: a provider response is untrusted input, and a receipt that
 * echoed an arbitrary string back could carry a token or a consent URL into
 * durable storage.
 *
 * Order is meaningful — normalization emits in this order so a receipt is
 * deterministic regardless of how the provider ordered its response.
 */
const RECOGNIZED_SCOPES: Record<CalendarWriteProviderId, readonly string[]> = {
  outlook: [
    'offline_access',
    'openid',
    'User.Read',
    'Calendars.Read',
    'Calendars.ReadWrite',
  ],
  google: [
    'openid',
    'email',
    `${GOOGLE_AUTH}calendar.readonly`,
    `${GOOGLE_AUTH}calendar.events`,
  ],
};

/**
 * Everything an upgrade must request. This includes the provider's existing
 * read scopes on purpose: an upgrade must never come back narrower than the
 * read grant it replaces.
 *
 * Outlook needs no separate read scope because `Calendars.ReadWrite` supersedes
 * `Calendars.Read`; Entra will not issue both. Google's `calendar.events` does
 * not cover listing calendars, so `calendar.readonly` is carried forward.
 */
export function writeConsentScopeRequest(
  provider: CalendarWriteProviderId,
): readonly string[] {
  if (provider === 'outlook') {
    return ['offline_access', 'openid', 'User.Read', 'Calendars.ReadWrite'];
  }
  return ['openid', 'email', `${GOOGLE_AUTH}calendar.readonly`, `${GOOGLE_AUTH}calendar.events`];
}

/**
 * Reduce a provider's granted-scope response to recognized canonical tokens.
 * Accepts the space-delimited string providers actually return, or an array.
 */
export function normalizeGrantedScopes(
  provider: CalendarWriteProviderId,
  granted: readonly string[] | string,
): readonly string[] {
  const raw = typeof granted === 'string' ? granted.split(/\s+/) : granted;
  const seen = new Set<string>();

  for (const token of raw) {
    const candidate = stripResourcePrefix(provider, token.trim());
    if (!candidate) continue;
    const canonical = canonicalize(provider, candidate);
    if (canonical) seen.add(canonical);
  }

  return RECOGNIZED_SCOPES[provider].filter((scope) => seen.has(scope));
}

function stripResourcePrefix(provider: CalendarWriteProviderId, token: string): string {
  if (provider !== 'outlook') return token;
  return token.toLowerCase().startsWith(GRAPH_RESOURCE_PREFIX.toLowerCase())
    ? token.slice(GRAPH_RESOURCE_PREFIX.length)
    : token;
}

/**
 * Match against the recognized list and return the canonical spelling, or
 * undefined if this is not a scope we know.
 *
 * Outlook scopes are compared case-insensitively because Entra treats them that
 * way and its responses do not preserve our casing. Google scopes are URIs and
 * are matched exactly — a loose match there is dangerous, because
 * `calendar.events.readonly` contains `calendar.events` as a substring, so any
 * prefix or `includes` test would read a read-only grant as write.
 */
function canonicalize(
  provider: CalendarWriteProviderId,
  token: string,
): string | undefined {
  const recognized = RECOGNIZED_SCOPES[provider];
  if (provider === 'outlook') {
    return recognized.find((scope) => scope.toLowerCase() === token.toLowerCase());
  }
  return recognized.find((scope) => scope === token);
}

/**
 * The capability a set of granted scopes actually confers. Normalizes first, so
 * this is fail-safe even if handed a raw provider response.
 */
export function evaluateGrantedCapability(
  provider: CalendarWriteProviderId,
  grantedScopes: readonly string[],
): CalendarGrantCapability {
  const recognized = normalizeGrantedScopes(provider, grantedScopes);
  return recognized.includes(WRITE_SCOPE[provider]) ? 'write' : 'read';
}
